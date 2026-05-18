import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { ensureInSandbox, normalizePath, safeJoin } from '../../utils/path.js';
import { outlineSource } from '../ast/source-outline.js';
import { CONTEXT_AUDIT_ACTION, CONTEXT_AUDIT_PHASE } from '../audit-constants.js';
import { recordContextAuditEvent } from '../audit.js';
import { extractKeywords } from '../keywords.js';
import type { ContextServiceDeps } from '../service-deps.js';
import { assertNotAborted } from '../service-helpers.js';

import type { ContextGatherCtx, ContextPrimaryCtx } from './types.js';

const fileAdapter = new FileAdapter();

async function readMatchedFileContent(
  req: ContextPrimaryCtx['req'],
  file: string,
): Promise<string | null> {
  if (req.snapshotHash && req.checkpointManager) {
    return req.checkpointManager.readSnapshotFile(req.repoPath, req.snapshotHash, file);
  }

  try {
    const fullPath = ensureInSandbox(req.repoPath, safeJoin(req.repoPath, file));
    const stat = await fileAdapter.stat(fullPath);
    if (!stat.isFile() || stat.size > LIMITS.largeFileThresholdBytes) return null;
    return await fileAdapter.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

export function buildContextGatherStep(deps: ContextServiceDeps) {
  return async ({ req, diffScope, primaryText }: ContextPrimaryCtx): Promise<ContextGatherCtx> => {
    assertNotAborted(req.signal);
    const keywords = extractKeywords(req.instruction);
    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.keywordsExtracted,
      { count: keywords.length, keywords: keywords.slice(0, 5) },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.gather },
    );

    const [
      rgSnippets,
      diffRes,
      astRes,
      projectMetadata,
      gitHistory,
      projectTopology,
      knowledgeBase,
      runtimeArtifacts,
    ] = await Promise.all([
      deps.ripgrepGatherer.searchMultipleKeywords(keywords, req.repoPath, req.signal),
      deps.gitDiffGatherer.gather({ ...req, diffScope }),
      deps.astGatherer.gather(primaryText, req),
      deps.metadataGatherer.gather(req),
      deps.gitHistoryGatherer.gather(req),
      deps.architectureGatherer.gather(req),
      deps.knowledgeGatherer.gather(req),
      deps.artifactGatherer.gather(req),
    ]);
    assertNotAborted(req.signal);

    // 2nd Stage: Semantic/Ghost Dependency Probe
    const existingFiles = new Set(astRes.relatedFiles.map((f) => f.path));
    const ghostFiles = await deps.ghostDependencyGatherer.gather(primaryText, req, existingFiles);
    if (ghostFiles.length > 0) {
      astRes.relatedFiles.push(...ghostFiles);
    }

    const relatedSeen = new Set(astRes.relatedFiles.map((file) => file.path));
    const primaryPath = req.primaryFile
      ? normalizePath(req.primaryFile).replace(/^(\.\/|\/)+/, '')
      : undefined;
    for (const snippet of rgSnippets) {
      const file = normalizePath(snippet.file).replace(/^(\.\/|\/)+/, '');
      if (!file || file === primaryPath || relatedSeen.has(file)) continue;
      relatedSeen.add(file);
      const content = await readMatchedFileContent(req, file);
      astRes.relatedFiles.push({
        path: file,
        kind: 'dependency',
        mode: content ? 'full' : 'outline',
        content: content ?? `ripgrep match at line ${snippet.line}: ${snippet.content}`,
        outline: content ? outlineSource(content) : undefined,
      });
    }

    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.gatherCompleted,
      {
        rgSnippets: rgSnippets.length,
        includedFiles: diffRes.includedFiles.length,
        importedFiles: astRes.relatedFiles.length,
        ghostFiles: ghostFiles.length,
        syntaxErrors: astRes.syntaxErrors?.length ?? 0,
        hasParseError: Boolean(astRes.parseError),
        hasProjectMetadata: Boolean(projectMetadata),
        hasGitHistory: Boolean(gitHistory),
        hasProjectTopology: Boolean(projectTopology),
        hasKnowledgeBase: Boolean(knowledgeBase),
        hasRuntimeArtifacts: Boolean(runtimeArtifacts),
      },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.gather },
    );

    return {
      req,
      diffScope,
      primaryText,
      rgSnippets,
      projectMetadata,
      gitHistory,
      projectTopology,
      knowledgeBase,
      runtimeArtifacts,
      diff: {
        includedFiles: diffRes.includedFiles,
        stagedDiff: diffRes.stagedDiff,
        unstagedDiff: diffRes.unstagedDiff,
        gitDiff: diffRes.gitDiff,
      },
      ast: {
        relatedFiles: astRes.relatedFiles,
        repoMap: astRes.repoMap,
        symbolMap: astRes.symbolMap,
        controlFlow: astRes.controlFlow,
        exceptionPaths: astRes.exceptionPaths,
        symbols: astRes.symbols,
        definitionMap: astRes.definitionMap,
        languageId: astRes.languageId,
        syntaxErrors: astRes.syntaxErrors,
        parseError: astRes.parseError,
      },
    };
  };
}
