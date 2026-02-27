import { CONTEXT_AUDIT_ACTION, CONTEXT_AUDIT_PHASE } from '../audit-constants.js';
import { recordContextAuditEvent } from '../audit.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { assertNotAborted } from '../service-helpers.js';

import type { ContextGatherCtx, ContextTargetsCtx } from './types.js';

export function buildContextTargetsStep(deps: ContextServiceDeps) {
  return async ({
    req,
    diffScope,
    primaryText,
    rgSnippets,
    projectMetadata,
    gitHistory,
    projectTopology,
    knowledgeBase,
    runtimeArtifacts,
    diff,
    ast,
  }: ContextGatherCtx): Promise<ContextTargetsCtx> => {
    assertNotAborted(req.signal);
    const importRelatedFiles = (ast.relatedFiles ?? []).map((f) => f.path);
    const rgHitFiles = Array.from(new Set((rgSnippets ?? []).map((s) => s.file)));

    const symbolCandidates = req.instruction.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) ?? [];
    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.targetingCandidates,
      {
        explicitPathCandidates: (req.instruction.match(/\.\w{1,5}\b/g) || []).length,
        symbolCandidates: symbolCandidates.slice(0, 20),
      },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.targets },
    );

    const { targets, diffusionMetrics } = await deps.targetResolver.resolve({
      req,
      includedFiles: diff.includedFiles,
      importRelatedFiles,
      rgHitFiles,
      definitionMap: ast.definitionMap,
      symbolMap: ast.symbolMap,
      churnByFile: gitHistory?.churnByFile,
    });
    assertNotAborted(req.signal);

    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.targetsResolved,
      {
        strategyTargets: targets.map((t) => ({
          path: t.path,
          reason: t.reason,
          confidence: t.confidence,
        })),
        diffusionMetrics: diffusionMetrics
          ? {
              totalCandidates: diffusionMetrics.totalCandidates,
              selectedTargets: diffusionMetrics.selectedTargets,
              budgetLimit: diffusionMetrics.budgetLimit,
              sourceBreakdown: diffusionMetrics.sourceBreakdown,
            }
          : undefined,
      },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.targets },
    );

    return {
      req,
      diffScope,
      primaryText,
      rgSnippets,
      targets,
      projectMetadata,
      gitHistory,
      projectTopology,
      knowledgeBase,
      runtimeArtifacts,
      includedFiles: diff.includedFiles,
      stagedDiff: diff.stagedDiff,
      unstagedDiff: diff.unstagedDiff,
      gitDiff: diff.gitDiff,
      relatedFiles: ast.relatedFiles,
      symbols: ast.symbols,
      definitionMap: ast.definitionMap,
      repoMap: ast.repoMap,
      symbolMap: ast.symbolMap,
      analysis: {
        ast: {
          languageId: ast.languageId,
          syntaxErrors: ast.syntaxErrors,
          parseError: ast.parseError,
          controlFlow: ast.controlFlow,
          exceptionPaths: ast.exceptionPaths,
          notes: [
            'Type mismatch, dead code, and potential bug detection are not available in this analysis layer.',
          ],
        },
      },
    };
  };
}
