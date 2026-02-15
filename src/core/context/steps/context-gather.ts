import { recordContextAuditEvent } from '../audit.js';
import { extractKeywords } from '../keywords.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { assertNotAborted } from '../service-helpers.js';

import type { ContextGatherCtx, ContextPrimaryCtx } from './types.js';

export function buildContextGatherStep(deps: ContextServiceDeps) {
  return async ({ req, diffScope, primaryText }: ContextPrimaryCtx): Promise<ContextGatherCtx> => {
    assertNotAborted(req.signal);
    const keywords = extractKeywords(req.instruction);
    recordContextAuditEvent(
      'context.keywords.extracted',
      { count: keywords.length, keywords: keywords.slice(0, 5) },
      { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_GATHER' },
    );

    const [rgSnippets, diffRes, astRes] = await Promise.all([
      deps.ripgrepGatherer.searchMultipleKeywords(keywords, req.repoPath, req.signal),
      deps.gitDiffGatherer.gather({ ...req, diffScope }),
      deps.astGatherer.gather(primaryText, req),
    ]);
    assertNotAborted(req.signal);

    recordContextAuditEvent(
      'context.gather.completed',
      {
        rgSnippets: rgSnippets.length,
        includedFiles: diffRes.includedFiles.length,
        importedFiles: astRes.relatedFiles.length,
        syntaxErrors: astRes.syntaxErrors?.length ?? 0,
        hasParseError: Boolean(astRes.parseError),
      },
      { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_GATHER' },
    );

    return {
      req,
      diffScope,
      primaryText,
      rgSnippets,
      diff: {
        includedFiles: diffRes.includedFiles,
        stagedDiff: diffRes.stagedDiff,
        unstagedDiff: diffRes.unstagedDiff,
        gitDiff: diffRes.gitDiff,
      },
      ast: {
        relatedFiles: astRes.relatedFiles,
        symbols: astRes.symbols,
        definitionMap: astRes.definitionMap,
        languageId: astRes.languageId,
        syntaxErrors: astRes.syntaxErrors,
        parseError: astRes.parseError,
      },
    };
  };
}
