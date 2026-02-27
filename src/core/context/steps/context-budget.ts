import { LIMITS } from '../../config/limits.js';
import type { Context } from '../../types/index.js';
import { DefaultPromptAssembler } from '../assembly/default-prompt-assembler.js';
import { CONTEXT_AUDIT_ACTION, CONTEXT_AUDIT_PHASE } from '../audit-constants.js';
import { recordContextAuditEvent } from '../audit.js';
import { applySmartCompression } from '../compression/smart-compress.js';
import { createContextHash, createIntentSignature } from '../hash.js';
import {
  buildContextBudgetPolicyPlan,
  executeContextBudgetPolicyPlan,
} from '../policies/budget-policy.js';
import { packUntilFull } from '../policies/pack-until-full.js';
import { rankContextForRelevance } from '../scoring/relevance.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { calculateSectionChars, calculateUsedChars } from '../service-helpers.js';
import type { ContextBudgetAllocation, ContextResult, ContextSectionChars } from '../types.js';

import type { ContextTargetsCtx } from './types.js';

const BUDGET_RATIO = {
  primary: 0.6,
  related: 0.3,
  secondary: 0.1,
} as const;

function computeBudgetAllocation(
  budgetChars: number,
  sectionChars: ContextSectionChars,
): ContextBudgetAllocation {
  const primaryBudget = Math.max(0, Math.floor(budgetChars * BUDGET_RATIO.primary));
  const relatedBudget = Math.max(0, Math.floor(budgetChars * BUDGET_RATIO.related));
  const secondaryBudget = Math.max(0, budgetChars - primaryBudget - relatedBudget);
  const secondaryUsed = Math.max(0, sectionChars.rgSnippets + sectionChars.diffs);

  return {
    ratio: {
      primary: BUDGET_RATIO.primary,
      related: BUDGET_RATIO.related,
      secondary: BUDGET_RATIO.secondary,
    },
    budgetChars: {
      primary: primaryBudget,
      related: relatedBudget,
      secondary: secondaryBudget,
    },
    usedChars: {
      primary: sectionChars.primary,
      related: sectionChars.relatedFiles,
      secondary: secondaryUsed,
    },
  };
}

export function buildContextBudgetStep(deps: ContextServiceDeps) {
  const assembler = deps.assembler ?? new DefaultPromptAssembler();

  return async ({
    req,
    diffScope,
    primaryText,
    rgSnippets,
    targets,
    targetSetSignature,
    includedFiles,
    stagedDiff,
    unstagedDiff,
    gitDiff,
    relatedFiles,
    symbols,
    definitionMap,
    analysis,
    repoMap,
    symbolMap,
    projectMetadata,
    gitHistory,
    projectTopology,
    knowledgeBase,
    runtimeArtifacts,
  }: ContextTargetsCtx): Promise<ContextResult> => {
    const workspaceMode = req.workspaceMode ?? 'direct';
    const context: Context = {
      repoPath: req.repoPath,
      instruction: req.instruction,
      primaryFile: req.primaryFile,
      workspaceMode,
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
      repoMap,
      symbolMap,
      projectMetadata,
      gitHistory,
      projectTopology,
      knowledgeBase,
      runtimeArtifacts,
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
      CONTEXT_AUDIT_ACTION.budgetPolicyPlan,
      {
        workerId: budgetPolicyPlan.workerId,
        actions: budgetPolicyPlan.actions.map((a) => a.type),
        decisionTree: budgetPolicyPlan.decisionTree,
      },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.budget },
    );

    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.relevanceRanking,
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
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.budget },
    );

    const budget = req.budgetChars;
    const budgeted = executeContextBudgetPolicyPlan({
      plan: budgetPolicyPlan,
      context: ranked,
      fallbackBudgetChars: budget ?? LIMITS.maxContextChars,
      pack: packUntilFull,
    });

    const assembled = assembler.assemble(budgeted.context, req);
    const contextHash = createContextHash(budgeted.context);
    const sectionChars = calculateSectionChars(budgeted.context);
    const requestedBudgetChars = budget ?? LIMITS.maxContextChars;
    const budgetAllocation = computeBudgetAllocation(requestedBudgetChars, sectionChars);
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
      CONTEXT_AUDIT_ACTION.packSummary,
      {
        intentSignature: createIntentSignature({
          instruction: req.instruction,
          primaryFile: req.primaryFile,
          selection: req.selection,
          diffScope: req.diffScope,
        }),
        targetSetSignature,
        cacheKeyHint: [
          req.repoPath,
          req.snapshotHash ?? '',
          req.diffScope ?? 'primary',
          workspaceMode,
        ].join('::'),
        requestedBudgetChars: budget,
        preBudgetSectionChars,
        sectionChars,
        budgetAllocation,
        truncated: budgeted.truncated,
        droppedSections,
      },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.budget },
    );

    return {
      context: {
        ...budgeted.context,
        contextHash,
        targetSetSignature,
      },
      prompt: assembled.prompt,
      meta: {
        usedChars: calculateUsedChars(budgeted.context),
        truncated: budgeted.truncated,
        diffScope,
        includedFiles,
        requestedBudgetChars: budget,
        preBudgetSectionChars,
        sectionChars,
        budgetAllocation,
        contextHash,
        targetSetSignature,
        environment: {
          workspaceMode,
        },
        droppedSections,
        ...(assembled.meta || {}),
      },
    } satisfies ContextResult;
  };
}
