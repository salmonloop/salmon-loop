import { recordAuditEvent } from '../../observability/audit-trail.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { assertNotAborted } from '../service-helpers.js';

import type { ContextGatherCtx, ContextTargetsCtx } from './types.js';

export function buildContextTargetsStep(deps: ContextServiceDeps) {
  return async ({
    req,
    diffScope,
    primaryText,
    rgSnippets,
    diff,
    ast,
  }: ContextGatherCtx): Promise<ContextTargetsCtx> => {
    assertNotAborted(req.signal);
    const importRelatedFiles = (ast.relatedFiles ?? []).map((f) => f.path);
    const rgHitFiles = Array.from(new Set((rgSnippets ?? []).map((s) => s.file)));

    const symbolCandidates = req.instruction.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) ?? [];
    recordAuditEvent(
      'context.targeting.candidates',
      {
        explicitPathCandidates: (req.instruction.match(/\.\w{1,5}\b/g) || []).length,
        symbolCandidates: symbolCandidates.slice(0, 20),
      },
      { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_TARGETS' },
    );

    const { targets } = await deps.targetResolver.resolve({
      req,
      includedFiles: diff.includedFiles,
      importRelatedFiles,
      rgHitFiles,
      definitionMap: ast.definitionMap,
    });
    assertNotAborted(req.signal);

    recordAuditEvent(
      'context.targets.resolved',
      {
        strategyTargets: targets.map((t) => ({
          path: t.path,
          reason: t.reason,
          confidence: t.confidence,
        })),
      },
      { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_TARGETS' },
    );

    return {
      req,
      diffScope,
      primaryText,
      rgSnippets,
      targets,
      includedFiles: diff.includedFiles,
      stagedDiff: diff.stagedDiff,
      unstagedDiff: diff.unstagedDiff,
      gitDiff: diff.gitDiff,
      relatedFiles: ast.relatedFiles,
      symbols: ast.symbols,
      definitionMap: ast.definitionMap,
      analysis: {
        ast: {
          languageId: ast.languageId,
          syntaxErrors: ast.syntaxErrors,
          parseError: ast.parseError,
          notes: [
            'Type mismatch, dead code, and potential bug detection are not available in this analysis layer.',
          ],
        },
      },
    };
  };
}
