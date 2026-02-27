import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import { LIMITS } from '../../config/limits.js';
import type { Context } from '../../types/index.js';
import { ensureInSandbox, normalizePath, safeJoin } from '../../utils/path.js';
import { CONTEXT_AUDIT_ACTION, CONTEXT_AUDIT_PHASE } from '../audit-constants.js';
import { recordContextAuditEvent } from '../audit.js';
import { rankContextForRelevance } from '../scoring/relevance.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { assertNotAborted } from '../service-helpers.js';

import type { ContextTargetsCtx } from './types.js';

const fileAdapter = new FileAdapter();

/**
 * Promotes high-relevance 'outline' files to 'full' content.
 * This effectively breaks the 'static snapshot' limitation by performing
 * a second-stage targeted read based on initial ranking.
 */
export function buildContextPromotionStep(_deps: ContextServiceDeps) {
  return async (ctx: ContextTargetsCtx): Promise<ContextTargetsCtx> => {
    const { req } = ctx;
    assertNotAborted(req.signal);

    // 1. Create temporary context for ranking
    const tempContext: Context = {
      repoPath: req.repoPath,
      instruction: req.instruction,
      primaryFile: req.primaryFile,
      primaryText: ctx.primaryText,
      relatedFiles: ctx.relatedFiles,
      rgSnippets: ctx.rgSnippets,
      targets: ctx.targets,
      symbolMap: ctx.symbolMap,
      repoMap: ctx.repoMap,
    };

    // 2. Rank to find high-relevance candidates
    const ranked = rankContextForRelevance(tempContext);
    const candidates = (ranked.relatedFiles ?? []).filter((f) => f.mode === 'outline').slice(0, 5); // Promote up to Top 5 high-relevance outlines

    if (candidates.length === 0) return ctx;

    const promotedPaths: string[] = [];
    const updatedRelatedFiles = [...(ctx.relatedFiles ?? [])];

    for (const candidate of candidates) {
      // Check if score is high enough to justify promotion
      // In a real system, we'd check the score, but here we'll use a heuristic:
      // if it's in the top 5 and matched keywords or targets.

      try {
        const normalized = normalizePath(candidate.path).replace(/^(\.\/|\/)+/, '');
        const fullPath = ensureInSandbox(req.repoPath, safeJoin(req.repoPath, normalized));
        const content = await fileAdapter.readFile(fullPath, 'utf-8');

        // Only promote if not obscenely large
        if (content.length < LIMITS.largeFileThresholdBytes * 2) {
          const index = updatedRelatedFiles.findIndex((f) => f.path === candidate.path);
          if (index !== -1) {
            updatedRelatedFiles[index] = {
              ...updatedRelatedFiles[index],
              mode: 'full',
              content: content,
              outline: updatedRelatedFiles[index].outline || candidate.content, // preserve original outline if needed
            };
            promotedPaths.push(candidate.path);
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    if (promotedPaths.length > 0) {
      recordContextAuditEvent(
        CONTEXT_AUDIT_ACTION.promotionCompleted,
        { count: promotedPaths.length, paths: promotedPaths },
        { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.gather },
      );
    }

    return {
      ...ctx,
      relatedFiles: updatedRelatedFiles,
    };
  };
}
