import { readFile } from 'fs/promises';

import { text } from '../../../locales/index.js';
import { AstParser } from '../../ast/parser.js';
import { checkSyntaxErrors } from '../../ast/validator.js';
import { LIMITS } from '../../config/limits.js';
import { logger } from '../../observability/logger.js';
import { pluginRegistry } from '../../plugin/registry.js';
import type {
  AstSyntaxError,
  CodeLocation,
  ContextAnalysis,
  RepoMap,
  RepoMapEdge,
  RepoMapNode,
  RelatedFileContext,
  SymbolMap,
  SymbolInfo,
} from '../../types/index.js';
import { normalizePath, safeJoin } from '../../utils/path.js';
import { extractImportSpecifiers } from '../ast/import-extractor.js';
import { resolveImportCandidates } from '../ast/module-resolver.js';
import { outlineSource } from '../ast/source-outline.js';
import type { ContextRequest } from '../types.js';

export interface AstResult {
  symbols: SymbolInfo[];
  definitionMap: Record<string, CodeLocation>;
  relatedFiles: RelatedFileContext[];
  repoMap?: RepoMap;
  symbolMap?: SymbolMap;
  controlFlow?: NonNullable<ContextAnalysis['ast']>['controlFlow'];
  exceptionPaths?: NonNullable<ContextAnalysis['ast']>['exceptionPaths'];
  languageId?: string;
  syntaxErrors?: AstSyntaxError[];
  parseError?: string;
}

const AST_DEEP_TRIGGER_PATTERN =
  /\b(refactor|rename|migrate|cross[- ]?file|across|dependency|dependencies|module|architecture|global)\b/i;

function getImportScanDepth(req: ContextRequest): { depth: number; trigger: RepoMap['trigger'] } {
  const instruction = req.instruction || '';
  if (AST_DEEP_TRIGGER_PATTERN.test(instruction)) {
    return { depth: LIMITS.maxDependencyDepth, trigger: 'deep' };
  }
  return { depth: 1, trigger: 'shallow' };
}

function buildSymbolMap(
  symbols: SymbolInfo[],
  primaryFile: string,
): {
  symbolMap: SymbolMap;
} {
  const definitions = symbols.filter((s) => s.kind === 'definition');
  const references = symbols.filter((s) => s.kind === 'reference');

  const nodes: SymbolMap['nodes'] = [];
  const edges: SymbolMap['edges'] = [];
  const definitionNodeByName = new Map<string, string>();

  for (const def of definitions) {
    const id = `def:${def.name}:${def.location.start.line}:${def.location.start.column}`;
    definitionNodeByName.set(def.name, id);
    nodes.push({
      id,
      name: def.name,
      kind: 'definition',
      path: primaryFile,
      location: def.location,
    });
  }

  for (const ref of references) {
    const refId = `ref:${ref.name}:${ref.location.start.line}:${ref.location.start.column}`;
    nodes.push({
      id: refId,
      name: ref.name,
      kind: 'reference',
      path: primaryFile,
      location: ref.location,
    });

    const targetDefId = definitionNodeByName.get(ref.name);
    if (!targetDefId) continue;

    const snippet = ref.snippet || '';
    const edgeType: 'reference' | 'call' = /\w+\s*\(/.test(snippet) ? 'call' : 'reference';
    edges.push({
      from: refId,
      to: targetDefId,
      type: edgeType,
      confidence: 'high',
    });
  }

  return { symbolMap: { nodes, edges } };
}

function summarizeControlFlow(primaryText: string): {
  controlFlow: NonNullable<ContextAnalysis['ast']>['controlFlow'];
  exceptionPaths: NonNullable<ContextAnalysis['ast']>['exceptionPaths'];
} {
  const branchMatches = primaryText.match(/\b(if|else\s+if|switch|\?)\b/g) || [];
  const loopMatches = primaryText.match(/\b(for|while|do)\b/g) || [];
  const asyncMatches = primaryText.match(/\b(await|Promise\.all|Promise\.race|setTimeout|setInterval)\b/g) || [];

  const tryCatchMatches = primaryText.match(/\btry\b|\bcatch\b/g) || [];
  const throwMatches = primaryText.match(/\bthrow\b/g) || [];
  const promiseCatchMatches = primaryText.match(/\.catch\s*\(/g) || [];

  const controlHotspots: string[] = [];
  if (branchMatches.length >= 3) controlHotspots.push('dense_branching');
  if (loopMatches.length >= 2) controlHotspots.push('nested_or_multiple_loops');
  if (asyncMatches.length >= 2) controlHotspots.push('multiple_async_boundaries');

  const exceptionHotspots: string[] = [];
  if (tryCatchMatches.length >= 2) exceptionHotspots.push('multiple_try_catch_paths');
  if (throwMatches.length >= 2) exceptionHotspots.push('multiple_throw_sites');
  if (promiseCatchMatches.length >= 2) exceptionHotspots.push('multiple_promise_catch_paths');

  return {
    controlFlow: {
      branchCount: branchMatches.length,
      loopCount: loopMatches.length,
      asyncBoundaryCount: asyncMatches.length,
      hotspots: controlHotspots,
    },
    exceptionPaths: {
      tryCatchCount: Math.floor(tryCatchMatches.length / 2),
      throwCount: throwMatches.length,
      promiseCatchCount: promiseCatchMatches.length,
      hotspots: exceptionHotspots,
    },
  };
}

/**
 * Resolve language ID from file path using plugin registry.
 * Zero hardcoded language mappings - fully dynamic via registered plugins.
 */
function getLanguageFromFile(filePath: string): string | undefined {
  const plugin = pluginRegistry.getByExtension(filePath);
  return plugin?.meta.id;
}

export class AstGatherer {
  async gather(primaryText: string | undefined, req: ContextRequest): Promise<AstResult> {
    if (!primaryText || !req.primaryFile) {
      return { symbols: [], definitionMap: {}, relatedFiles: [] };
    }

    const diagnostics = await this.gatherDiagnostics(primaryText, req.primaryFile);
    const symbolsResult = await this.gatherSymbols(primaryText, req.primaryFile, diagnostics.tree);
    const importedResult = await this.gatherImportedFiles(primaryText, req);
    const { symbolMap } = buildSymbolMap(symbolsResult.symbols, req.primaryFile);
    const controlFlowSummary = summarizeControlFlow(primaryText);

    return {
      symbols: symbolsResult.symbols,
      definitionMap: symbolsResult.definitionMap,
      relatedFiles: importedResult.relatedFiles,
      repoMap: importedResult.repoMap,
      symbolMap,
      controlFlow: controlFlowSummary.controlFlow,
      exceptionPaths: controlFlowSummary.exceptionPaths,
      languageId: diagnostics.languageId,
      syntaxErrors: diagnostics.syntaxErrors,
      parseError: diagnostics.parseError,
    };
  }

  private async gatherSymbols(
    primaryText: string,
    primaryFile: string,
    parsedTree?: any,
  ): Promise<Pick<AstResult, 'symbols' | 'definitionMap'>> {
    try {
      const lang = getLanguageFromFile(primaryFile);
      if (!lang) return { symbols: [], definitionMap: {} };

      const tree = parsedTree ?? (await AstParser.parse(primaryText, lang));
      const defs = await AstParser.identifyDefinitions(tree, lang);
      const refs = await AstParser.identifyReferences(tree, lang);

      const definitionMap: Record<string, CodeLocation> = {};
      for (const def of defs) {
        definitionMap[def.name] = def.location;
      }

      return { symbols: [...defs, ...refs], definitionMap };
    } catch (e) {
      logger.debug(`  [CONTEXT] Symbol extraction unavailable for ${primaryFile}: ${e}`);
      return { symbols: [], definitionMap: {} };
    }
  }

  private async gatherDiagnostics(
    primaryText: string,
    primaryFile: string,
  ): Promise<{
    languageId?: string;
    syntaxErrors?: AstSyntaxError[];
    parseError?: string;
    tree?: any;
  }> {
    const languageId = getLanguageFromFile(primaryFile);
    if (!languageId)
      return { languageId: undefined, syntaxErrors: undefined, parseError: undefined };

    try {
      const tree = await AstParser.parse(primaryText, languageId);
      const rawErrors = checkSyntaxErrors(tree);
      const syntaxErrors: AstSyntaxError[] =
        rawErrors.length > 0
          ? rawErrors.slice(0, 50).map((e) => ({
              line: e.line + 1,
              column: e.column + 1,
              type: e.type,
              text: String(e.text || '').slice(0, 200),
            }))
          : [];

      return {
        languageId,
        syntaxErrors,
        tree,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug(`  [CONTEXT] AST diagnostics unavailable for ${primaryFile}: ${msg}`);
      return { languageId, syntaxErrors: undefined, parseError: msg };
    }
  }

  private async gatherImportedFiles(
    primaryText: string,
    req: ContextRequest,
  ): Promise<{ relatedFiles: RelatedFileContext[]; repoMap: RepoMap }> {
    const primaryPath = normalizePath(req.primaryFile || '').replace(/^(\.\/|\/)+/, '');
    const depthSettings = getImportScanDepth(req);
    const queue: Array<{ from: string; text: string; depth: number }> = [
      { from: primaryPath, text: primaryText, depth: 1 },
    ];
    const visitedForScan = new Set<string>();
    const related: RelatedFileContext[] = [];
    const relatedSeen = new Set<string>();
    const repoNodes = new Map<string, RepoMapNode>();
    const repoEdges = new Map<string, RepoMapEdge>();

    if (primaryPath) {
      repoNodes.set(primaryPath, { path: primaryPath, depth: 0, source: 'primary' });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visitedForScan.has(current.from)) continue;
      visitedForScan.add(current.from);

      const specifiers = extractImportSpecifiers(current.text).filter((s) => s.startsWith('.'));
      for (const spec of specifiers) {
        const candidates = resolveImportCandidates({
          currentFile: current.from,
          specifier: spec,
        });
        if (candidates.length === 0) continue;

        const resolved = await this.pickFirstExisting(req, candidates);
        if (!resolved) continue;

        const normalized = normalizePath(resolved).replace(/^(\.\/|\/)+/, '');
        if (!normalized || normalized === primaryPath) continue;

        const edgeKey = `${current.from}->${normalized}`;
        if (!repoEdges.has(edgeKey)) {
          repoEdges.set(edgeKey, { from: current.from, to: normalized, type: 'import' });
        }

        const existingNode = repoNodes.get(normalized);
        if (!existingNode || existingNode.depth > current.depth) {
          repoNodes.set(normalized, {
            path: normalized,
            depth: current.depth,
            source: 'import',
          });
        }

        const content = await this.readRepoFile(req, normalized);
        if (content === null) continue;

        if (!relatedSeen.has(normalized)) {
          relatedSeen.add(normalized);
          const outline = outlineSource(content);
          const isLarge = content.length > LIMITS.largeFileThresholdBytes;
          related.push({
            path: normalized,
            kind: 'import',
            mode: isLarge ? 'outline' : 'full',
            content: isLarge ? `${outline}\n\n${text.context.relatedContentTruncated}` : content,
            outline: isLarge ? undefined : outline || undefined,
          });
        }

        if (
          current.depth < depthSettings.depth &&
          !visitedForScan.has(normalized) &&
          repoNodes.size < LIMITS.maxRelatedFiles + 1
        ) {
          queue.push({ from: normalized, text: content, depth: current.depth + 1 });
        }
      }
    }

    return {
      relatedFiles: related,
      repoMap: {
        nodes: Array.from(repoNodes.values()),
        edges: Array.from(repoEdges.values()),
        maxDepth: depthSettings.depth,
        trigger: depthSettings.trigger,
      },
    };
  }

  private async pickFirstExisting(
    req: ContextRequest,
    candidates: string[],
  ): Promise<string | null> {
    for (const c of candidates) {
      if (req.snapshotHash && req.checkpointManager) {
        const content = await req.checkpointManager
          .readSnapshotFile(req.repoPath, req.snapshotHash, c)
          .catch(() => null);
        if (content !== null) return c;
        continue;
      }

      try {
        await readFile(safeJoin(req.repoPath, c), 'utf-8');
        return c;
      } catch {
        // continue
      }
    }

    return null;
  }

  private async readRepoFile(req: ContextRequest, filePath: string): Promise<string | null> {
    if (req.snapshotHash && req.checkpointManager) {
      return await req.checkpointManager
        .readSnapshotFile(req.repoPath, req.snapshotHash, filePath)
        .catch(() => null);
    }

    try {
      return await readFile(safeJoin(req.repoPath, filePath), 'utf-8');
    } catch {
      return null;
    }
  }
}
