import { LIMITS } from '../../config/limits.js';
import type { Context } from '../../types/index.js';
import { DefaultPromptAssembler } from '../assembly/default-prompt-assembler.js';
import { recordContextAuditEvent } from '../audit.js';
import { applySmartCompression } from '../compression/smart-compress.js';
import {
  buildContextBudgetPolicyPlan,
  executeContextBudgetPolicyPlan,
} from '../policies/budget-policy.js';
import { packUntilFull } from '../policies/pack-until-full.js';
import { rankContextForRelevance } from '../scoring/relevance.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { calculateSectionChars, calculateUsedChars } from '../service-helpers.js';
import type { ContextResult } from '../types.js';

import type { ContextTargetsCtx } from './types.js';

export function buildContextBudgetStep(deps: ContextServiceDeps) {
  const assembler = deps.assembler ?? new DefaultPromptAssembler();

  return async ({
    req,
    diffScope,
    primaryText,
    rgSnippets,
    targets,
    includedFiles,
    stagedDiff,
    unstagedDiff,
    gitDiff,
    relatedFiles,
    symbols,
    definitionMap,
    analysis,
  }: ContextTargetsCtx): Promise<ContextResult> => {
    const context: Context = {
      repoPath: req.repoPath,
      primaryFile: req.primaryFile,
      primaryText,
      relatedFiles,
      rgSnippets,
      gitDiff,
      stagedDiff,
      unstagedDiff,
      untrackedDiff: undefined,
      untrackedFiles: [],
      symbols,
      definitionMap,
      targets,
      analysis,
    };

    const compressed = applySmartCompression(context, { budgetChars: req.budgetChars });
    const ranked = rankContextForRelevance(compressed);
    const preBudgetSectionChars = calculateSectionChars(ranked);

    const budgetPolicyPlan = buildContextBudgetPolicyPlan({
      requestedBudgetChars: req.budgetChars,
      preBudgetSectionChars,
      targetCount: (ranked.targets ?? []).length,
    });
    recordContextAuditEvent(
      'context.budget.policy.plan',
      {
        workerId: budgetPolicyPlan.workerId,
        actions: budgetPolicyPlan.actions.map((a) => a.type),
        decisionTree: budgetPolicyPlan.decisionTree,
      },
      { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_BUDGET' },
    );

    recordContextAuditEvent(
      'context.relevance.ranking',
      {
        topRelatedFiles: (ranked.relatedFiles ?? []).slice(0, 10).map((f) => ({
          path: f.path,
          kind: f.kind,
          mode: f.mode,
        })),
        snippetFiles: Array.from(
          new Set((ranked.rgSnippets ?? []).slice(0, 20).map((s) => s.file)),
        ),
      },
      { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_BUDGET' },
    );

    const budget = req.budgetChars;
    const budgeted = executeContextBudgetPolicyPlan({
      plan: budgetPolicyPlan,
      context: ranked,
      fallbackBudgetChars: budget ?? LIMITS.maxContextChars,
      pack: packUntilFull,
    });

    const assembled = assembler.assemble(budgeted.context, req);
    const sectionChars = calculateSectionChars(budgeted.context);
    const droppedSections =
      budgeted.truncated && preBudgetSectionChars.diffs > 0
        ? {
            stagedDiff:
              ranked.stagedDiff !== undefined && budgeted.context.stagedDiff === undefined,
            unstagedDiff:
              ranked.unstagedDiff !== undefined && budgeted.context.unstagedDiff === undefined,
            gitDiff: ranked.gitDiff !== undefined && budgeted.context.gitDiff === undefined,
            untrackedDiff:
              ranked.untrackedDiff !== undefined && budgeted.context.untrackedDiff === undefined,
          }
        : undefined;

    recordContextAuditEvent(
      'context.pack.summary',
      {
        requestedBudgetChars: budget,
        preBudgetSectionChars,
        sectionChars,
        truncated: budgeted.truncated,
        droppedSections,
      },
      { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_BUDGET' },
    );

    return {
      context: budgeted.context,
      prompt: assembled.prompt,
      meta: {
        usedChars: calculateUsedChars(budgeted.context),
        truncated: budgeted.truncated,
        diffScope,
        includedFiles,
        requestedBudgetChars: budget,
        preBudgetSectionChars,
        sectionChars,
        droppedSections,
        ...(assembled.meta || {}),
      },
    } satisfies ContextResult;
  };
}
