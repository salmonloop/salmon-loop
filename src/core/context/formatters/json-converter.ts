/**
 * High-performance XML to JSON context format converter
 * Optimized for token efficiency and performance
 */

import { XMLParser } from 'fast-xml-parser';

import type {
  AstSyntaxError,
  Context,
  ContextAnalysis,
  ContextTarget,
  RelatedFileContext,
  RepoMap,
  RepoMapEdge,
  RepoMapNode,
  RipgrepResult,
  SymbolMap,
  SymbolMapEdge,
  SymbolMapNode,
  TargetEvidence,
} from '../../types/index.js';
import { normalizePath } from '../../utils/path.js';

import type {
  JsonAnalysis,
  JsonAST,
  JsonContext,
  JsonContextData,
  JsonControlFlow,
  JsonDiffs,
  JsonExceptionPaths,
  JsonEvidence,
  JsonManifest,
  JsonRepoMap,
  JsonSymbolMap,
  JsonSyntaxError,
  JsonTarget,
  FormatPreference,
  FormatRequest,
  PerformanceMetrics,
} from './types.js';

type ContextAst = NonNullable<ContextAnalysis['ast']>;

export class ContextFormatConverter {
  private static readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  });

  /**
   * Convert XML format context to optimized JSON format
   */
  static xmlToJson(xmlContext: string): JsonContextData {
    const parsed = this.parser.parse(xmlContext);
    const context = this.extractContextFromXML(parsed);
    return this.contextToJson(context);
  }

  /**
   * Convert Context object directly to optimized JSON format
   */
  static contextToJson(context: Context): JsonContextData {
    // Use more compact structure
    const jsonContext: any = {
      m: this.convertManifest(context),
    };

    // Optional fields (only added when present)
    if (context.primaryFile && context.primaryText) {
      jsonContext.pf = [context.primaryFile, context.primaryText];
    }

    if (context.relatedFiles && context.relatedFiles.length > 0) {
      jsonContext.rf = context.relatedFiles.map((f) => [
        f.path,
        f.kind,
        f.mode === 'full' ? 'f' : 'o',
        f.content,
      ]);
    }

    if (context.rgSnippets && context.rgSnippets.length > 0) {
      jsonContext.s = context.rgSnippets.map((s) => [s.file, s.line, s.content]);
    }

    const diffs = this.convertDiffs(context);
    if (Object.keys(diffs).length > 0) {
      jsonContext.d = diffs;
    }

    if (context.analysis) {
      jsonContext.a = this.convertAnalysis(context.analysis!);
    }

    if (context.projectMetadata) {
      jsonContext.pm = {
        pj: context.projectMetadata.packageJson,
        rh: context.projectMetadata.readmeHeader,
        cf: context.projectMetadata.configFiles,
        ai: context.projectMetadata.aiInstructions,
      };
    }

    if (context.gitHistory) {
      jsonContext.gh = {
        rc: context.gitHistory.recentCommits,
      };
    }

    if (context.projectTopology) {
      jsonContext.pt = {
        ms: context.projectTopology.modules.map((m) => ({
          n: m.name,
          p: m.path,
          d: m.description,
          er: ContextFormatConverter.convertModuleRole(m.estimatedRole),
        })),
        fs: context.projectTopology.folderStructure,
      };
    }

    if (context.knowledgeBase) {
      jsonContext.kb = {
        pr: context.knowledgeBase.project_rules,
        ad: context.knowledgeBase.architectural_decisions?.map((d) => [
          d.date,
          d.decision,
          d.related_files,
        ]),
        up: context.knowledgeBase.user_preferences,
      };
    }

    if (context.runtimeArtifacts) {
      jsonContext.ra = {
        bd: context.runtimeArtifacts.buildDirs,
        ev: context.runtimeArtifacts.envVars,
        lf: context.runtimeArtifacts.lockFiles?.map((l) => [l.path, l.hash]),
      };
    }

    return {
      c: jsonContext,
    };
  }

  private static convertModuleRole(
    role: 'core' | 'adapter' | 'cli' | 'util' | 'other' | undefined,
  ): 'c' | 'a' | 'cl' | 'u' | 'o' | undefined {
    if (!role) return undefined;
    const map = {
      core: 'c',
      adapter: 'a',
      cli: 'cl',
      util: 'u',
      other: 'o',
    } as const;
    return map[role];
  }

  /**
   * Compute diff between two contexts for incremental updates
   */
  static computeJsonDiff(
    oldContext: Context,
    newContext: Context,
  ): {
    changed: boolean;
    changes: string[];
    diff: Partial<JsonContext>;
  } {
    const changes: string[] = [];
    const diff: Partial<JsonContext> = {};

    // Check primary file changes
    if (oldContext.primaryText !== newContext.primaryText) {
      changes.push('primaryFile');
      if (newContext.primaryFile && newContext.primaryText) {
        diff.pf = [newContext.primaryFile, newContext.primaryText];
      }
    }

    // Check related files changes
    if (this.arraysDiffer(oldContext.relatedFiles, newContext.relatedFiles)) {
      changes.push('relatedFiles');
      if (newContext.relatedFiles && newContext.relatedFiles.length > 0) {
        diff.rf = newContext.relatedFiles.map((f) => [
          f.path,
          f.kind,
          f.mode === 'full' ? 'f' : 'o',
          f.content,
        ]);
      }
    }

    // Check targets changes
    if (this.arraysDiffer(oldContext.targets, newContext.targets)) {
      changes.push('targets');
      diff.m = this.convertManifest(newContext);
    }

    // Check diffs changes
    const oldDiffs = this.convertDiffs(oldContext);
    const newDiffs = this.convertDiffs(newContext);
    if (JSON.stringify(oldDiffs) !== JSON.stringify(newDiffs)) {
      changes.push('diffs');
      diff.d = newDiffs;
    }

    return {
      changed: changes.length > 0,
      changes,
      diff,
    };
  }

  /**
   * Detect client format preference
   */
  static detectFormatPreference(request: FormatRequest): FormatPreference {
    const acceptHeader = request.headers?.accept || '';

    if (acceptHeader.includes('application/json')) {
      return 'json';
    }

    if (acceptHeader.includes('application/xml') || acceptHeader.includes('text/xml')) {
      return 'xml';
    }

    // Default fallback to XML for backward compatibility
    return 'xml';
  }

  /**
   * Calculate performance metrics
   */
  static calculatePerformanceMetrics(
    originalContext: Context,
    jsonResult: JsonContextData,
  ): PerformanceMetrics {
    // Estimate original XML size (simplified calculation)
    const xmlSize = this.estimateXMLSize(originalContext);
    const jsonSize = JSON.stringify(jsonResult).length;

    const tokenReduction = (xmlSize - jsonSize) / xmlSize;
    const compressionRatio = jsonSize / xmlSize;

    return {
      conversionTime: 0,
      originalSize: xmlSize,
      compressedSize: jsonSize,
      tokenReduction,
      compressionRatio,
    };
  }

  private static convertManifest(context: Context): JsonManifest {
    const manifest: JsonManifest = {};

    if (context.targets && context.targets.length > 0) {
      manifest.t = context.targets.map((t) => this.convertTarget(t));
    }

    if (context.repoMap) {
      manifest.rm = this.convertRepoMap(context.repoMap!);
    }

    if (context.symbolMap) {
      manifest.sm = this.convertSymbolMap(context.symbolMap!);
    }

    return manifest;
  }

  private static convertTarget(target: ContextTarget): JsonTarget {
    const evidence: JsonEvidence | undefined = target.evidence
      ? typeof target.evidence === 'string'
        ? { t: 'string', d: { raw: target.evidence } }
        : {
            t: target.evidence.type,
            n: target.evidence.details?.symbolName,
            d: target.evidence.details,
          }
      : undefined;

    return {
      p: target.path,
      r: target.reason,
      c: this.mapConfidence(target.confidence),
      e: evidence,
    };
  }

  private static convertRepoMap(repoMap: NonNullable<Context['repoMap']>): JsonRepoMap {
    return {
      tr: repoMap.trigger === 'shallow' ? 's' : 'd',
      md: repoMap.maxDepth,
      n: repoMap.nodes.map((node) => ({
        p: node.path,
        d: node.depth,
        s: node.source === 'primary' ? 'p' : 'i',
      })),
      e: repoMap.edges.map((edge) => ({
        f: edge.from,
        t: edge.to,
        ty: edge.type,
      })),
    };
  }

  private static convertSymbolMap(symbolMap: NonNullable<Context['symbolMap']>): JsonSymbolMap {
    return {
      n: symbolMap.nodes.map((node) => ({
        i: node.id,
        n: node.name,
        k: node.kind === 'definition' ? 'd' : 'r',
        p: node.path,
        l: node.location.start.line,
        co: node.location.start.column,
      })),
      e: symbolMap.edges.map((edge) => ({
        f: edge.from,
        t: edge.to,
        ty: edge.type,
        c: this.mapConfidence(edge.confidence),
      })),
    };
  }

  private static convertSnippet(snippet: Context['rgSnippets'][0]): [string, number, string] {
    return [snippet.file, snippet.line, snippet.content];
  }

  private static convertDiffs(context: Context): JsonDiffs {
    const diffs: JsonDiffs = {};

    if (context.stagedDiff) diffs.s = context.stagedDiff;
    if (context.unstagedDiff) diffs.u = context.unstagedDiff;
    if (context.gitDiff && !context.stagedDiff && !context.unstagedDiff) {
      diffs.g = context.gitDiff;
    }
    if (context.untrackedDiff) diffs.ut = context.untrackedDiff;

    return diffs;
  }

  private static convertAnalysis(analysis: ContextAnalysis): JsonAnalysis {
    if (!analysis.ast) return {};

    return {
      ast: this.convertAST(analysis.ast),
    };
  }

  private static convertAST(ast: ContextAst): JsonAST {
    const result: JsonAST = {};

    if (ast.languageId) result.l = ast.languageId;
    if (ast.parseError) result.pe = ast.parseError;
    if (ast.syntaxErrors && ast.syntaxErrors.length > 0) {
      result.se = ast.syntaxErrors.slice(0, 50).map((err) => this.convertSyntaxError(err));
    }
    if (ast.controlFlow) result.cf = this.convertControlFlow(ast.controlFlow);
    if (ast.exceptionPaths) result.ep = this.convertExceptionPaths(ast.exceptionPaths);
    if (ast.notes && ast.notes.length > 0) {
      result.n = ast.notes.slice(0, 10);
    }

    return result;
  }

  private static convertSyntaxError(error: AstSyntaxError): JsonSyntaxError {
    return {
      l: error.line,
      co: error.column,
      t: error.type === 'ERROR' ? 'E' : 'M',
      tx: error.text,
    };
  }

  private static convertControlFlow(cf: NonNullable<ContextAst['controlFlow']>): JsonControlFlow {
    return {
      b: cf.branchCount,
      lp: cf.loopCount,
      ab: cf.asyncBoundaryCount,
      h: cf.hotspots,
    };
  }

  private static convertExceptionPaths(
    ep: NonNullable<ContextAst['exceptionPaths']>,
  ): JsonExceptionPaths {
    return {
      tc: ep.tryCatchCount,
      th: ep.throwCount,
      pc: ep.promiseCatchCount,
      h: ep.hotspots,
    };
  }

  private static mapConfidence(confidence: string): 'h' | 'm' | 'l' {
    switch (confidence) {
      case 'high':
        return 'h';
      case 'medium':
        return 'm';
      case 'low':
        return 'l';
      default:
        return 'm';
    }
  }

  private static arraysDiffer<T>(a: T[] | undefined, b: T[] | undefined): boolean {
    if (!a && !b) return false;
    if (!a || !b) return true;
    if (a.length !== b.length) return true;

    return JSON.stringify(a) !== JSON.stringify(b);
  }

  private static estimateXMLSize(context: Context): number {
    // Rough XML size heuristic
    let size = 0;

    // Base layout overhead
    size += '<context></context>'.length;

    if (context.primaryText) {
      size += '<primary_file></primary_file>'.length;
      size += context.primaryText.length;
      size += '<![CDATA[]]>'.length;
    }

    if (context.relatedFiles) {
      size += '<related_files></related_files>'.length;
      for (const file of context.relatedFiles) {
        size += `<file></file>`.length;
        size += file.content.length;
        size += '<![CDATA[]]>'.length;
      }
    }

    // Estimate other fields...
    return size;
  }

  private static extractTargets(targetsNode: any): ContextTarget[] {
    const targets = this.ensureArray(targetsNode);
    return targets
      .filter((node) => node && node.path && node.reason)
      .map((node) => ({
        path: normalizePath(node.path),
        reason: node.reason,
        confidence: this.normalizeTargetConfidence(node.confidence),
        evidence: this.parseTargetEvidence(node.evidence),
      }));
  }

  private static extractRepoMap(node: any): RepoMap | undefined {
    if (!node) return undefined;
    const repoMap: RepoMap = {
      trigger: node.trigger === 'shallow' ? 'shallow' : 'deep',
      maxDepth: this.toNumber(node.max_depth),
      nodes: this.extractRepoNodes(node.nodes),
      edges: this.extractRepoEdges(node.edges),
    };

    if (!repoMap.nodes.length && !repoMap.edges.length) {
      return undefined;
    }

    return repoMap;
  }

  private static extractRepoNodes(container: any): RepoMapNode[] {
    const entries = this.ensureArray(container?.node);
    return entries
      .filter((entry) => entry && entry.path)
      .map((entry) => ({
        path: normalizePath(entry.path),
        depth: this.toNumber(entry.depth),
        source: entry.source === 'primary' ? 'primary' : 'import',
      }));
  }

  private static extractRepoEdges(container: any): RepoMapEdge[] {
    const entries = this.ensureArray(container?.edge);
    return entries
      .filter((entry) => entry && entry.from && entry.to && entry.type)
      .map((entry) => ({
        from: normalizePath(entry.from),
        to: normalizePath(entry.to),
        type: entry.type,
      }));
  }

  private static extractSymbolMap(container: any): SymbolMap | undefined {
    if (!container) return undefined;
    const nodes = this.ensureArray(container.nodes?.node)
      .filter((entry) => entry && entry.id && entry.name && entry.kind)
      .map((entry) => {
        const kind: SymbolMapNode['kind'] =
          entry.kind === 'definition' ? 'definition' : 'reference';
        return {
          id: entry.id,
          name: entry.name,
          kind,
          path: entry.path ? normalizePath(entry.path) : undefined,
          location: {
            start: {
              line: this.toNumber(entry.line),
              column: this.toNumber(entry.column),
            },
            end: {
              line: this.toNumber(entry.line),
              column: this.toNumber(entry.column),
            },
          },
        };
      });

    const edges = this.ensureArray(container.edges?.edge)
      .filter((entry) => entry && entry.from && entry.to && entry.type)
      .map((entry) => {
        const type: SymbolMapEdge['type'] = entry.type === 'call' ? 'call' : 'reference';
        return {
          from: entry.from,
          to: entry.to,
          type,
          confidence: this.normalizeConfidence(entry.confidence),
        };
      });

    if (!nodes.length && !edges.length) {
      return undefined;
    }

    return { nodes, edges };
  }

  private static normalizeConfidence(value: string | undefined): 'high' | 'medium' | 'low' {
    switch (value) {
      case 'high':
        return 'high';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  private static normalizeTargetConfidence(value: string | undefined): ContextTarget['confidence'] {
    switch (value) {
      case 'high':
        return 'high';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  private static extractRelatedFiles(container: any): RelatedFileContext[] {
    const entries = this.ensureArray(container?.file);
    return entries
      .filter((entry) => entry && entry.path && entry.reason && entry.mode)
      .map((entry) => ({
        path: normalizePath(entry.path),
        content: this.extractCDataValue(entry, '      ') ?? '',
        kind: entry.reason as RelatedFileContext['kind'],
        mode: entry.mode === 'full' ? 'full' : 'outline',
      }));
  }

  private static extractSnippets(container: any): RipgrepResult[] {
    const entries = this.ensureArray(container?.snippet);
    return entries
      .filter((entry) => entry && entry.file && entry.line)
      .map((entry) => ({
        file: normalizePath(entry.file),
        line: this.toNumber(entry.line),
        content: this.extractCDataValue(entry, '      ') ?? '',
      }));
  }

  private static extractDiffs(root: any): Partial<Context> {
    const diffResult: Partial<Context> = {};
    const staged = this.extractCDataValue(root.staged_diff, '    ');
    if (staged) diffResult.stagedDiff = staged;
    const unstaged = this.extractCDataValue(root.unstaged_diff, '    ');
    if (unstaged) diffResult.unstagedDiff = unstaged;
    const gitDiff = this.extractCDataValue(root.git_diff, '    ');
    if (gitDiff) diffResult.gitDiff = gitDiff;
    const untracked = this.extractCDataValue(root.untracked_diff, '    ');
    if (untracked) diffResult.untrackedDiff = untracked;
    return diffResult;
  }

  private static extractUntrackedFiles(container: any): string[] {
    const entries = this.ensureArray(container?.file);
    return entries.filter((entry) => entry && entry.path).map((entry) => normalizePath(entry.path));
  }

  private static extractAnalysis(astNode: any): ContextAst | undefined {
    if (!astNode) return undefined;

    const ast: ContextAst = {};

    if (astNode.language?.id) {
      ast.languageId = astNode.language.id;
    }

    const parseError = this.extractCDataValue(astNode.parse_error, '        ');
    if (parseError) {
      ast.parseError = parseError;
    }

    const syntaxEntries = this.ensureArray(astNode.syntax_errors?.error);
    if (syntaxEntries.length > 0) {
      ast.syntaxErrors = syntaxEntries.map((entry) => ({
        line: this.toNumber(entry.line),
        column: this.toNumber(entry.column),
        type: entry.type === 'MISSING' ? 'MISSING' : 'ERROR',
        text: this.extractCDataValue(entry, '          ') ?? '',
      }));
    }

    const notes = this.ensureArray(astNode.notes?.note)
      .map((note) => this.extractCDataValue(note, '          '))
      .filter((value): value is string => Boolean(value));
    if (notes.length) {
      ast.notes = notes;
    }

    if (astNode.control_flow) {
      const controlFlow: NonNullable<ContextAst['controlFlow']> = {
        branchCount: this.toNumber(astNode.control_flow.branches),
        loopCount: this.toNumber(astNode.control_flow.loops),
        asyncBoundaryCount: this.toNumber(astNode.control_flow.async_boundaries),
      };
      const hotspots = this.extractHotspots(astNode.control_flow.hotspots);
      if (hotspots.length) {
        controlFlow.hotspots = hotspots;
      }
      ast.controlFlow = controlFlow;
    }

    if (astNode.exception_paths) {
      const exceptionPaths: NonNullable<ContextAst['exceptionPaths']> = {
        tryCatchCount: this.toNumber(astNode.exception_paths.try_catch),
        throwCount: this.toNumber(astNode.exception_paths.throws),
        promiseCatchCount: this.toNumber(astNode.exception_paths.promise_catch),
      };
      const hotspots = this.extractHotspots(astNode.exception_paths.hotspots);
      if (hotspots.length) {
        exceptionPaths.hotspots = hotspots;
      }
      ast.exceptionPaths = exceptionPaths;
    }

    return Object.keys(ast).length ? ast : undefined;
  }

  private static extractHotspots(container: any): string[] {
    const entries = this.ensureArray(container?.hotspot);
    return entries
      .map((entry) => entry?.type)
      .filter((value): value is string => typeof value === 'string');
  }

  private static ensureArray<T>(value: T | T[] | null | undefined | ''): T[] {
    if (!value || value === '') return [];
    return Array.isArray(value) ? value : [value];
  }

  private static extractCDataValue(node: any, indent: string): string | undefined {
    if (!node) return undefined;
    const raw =
      node['#text'] ?? node['#cdata-section'] ?? (typeof node === 'string' ? node : undefined);
    if (typeof raw !== 'string') return undefined;
    let value = raw;
    if (value.startsWith('\n')) {
      value = value.slice(1);
    }
    const suffix = `\n${indent}`;
    if (value.endsWith(suffix)) {
      value = value.slice(0, -suffix.length);
    }
    return value;
  }

  private static toNumber(value: string | undefined): number {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private static parseTargetEvidence(raw: string | undefined): ContextTarget['evidence'] {
    if (!raw) return undefined;
    if (!raw.includes(':')) {
      return raw;
    }

    const [type, symbolName] = raw.split(':', 2);
    const allowedType: TargetEvidence['type'] = [
      'symbol',
      'path',
      'diff',
      'import',
      'ripgrep',
      'fallback',
    ].includes(type as TargetEvidence['type'])
      ? (type as TargetEvidence['type'])
      : 'symbol';

    return {
      type: allowedType,
      details: symbolName ? { symbolName } : undefined,
    };
  }

  private static extractContextFromXML(_parsed: any): Context {
    const root = _parsed?.context;
    if (!root) {
      throw new Error('XML context payload missing <context> root');
    }

    const context: Context = {
      repoPath: '',
      rgSnippets: [],
    };

    const manifest = root.manifest;
    const targets = this.extractTargets(manifest?.targets?.target);
    if (targets.length) {
      context.targets = targets;
    }

    const repoMap = this.extractRepoMap(manifest?.repo_map);
    if (repoMap) {
      context.repoMap = repoMap;
    }

    const symbolMap = this.extractSymbolMap(manifest?.symbol_map);
    if (symbolMap) {
      context.symbolMap = symbolMap;
    }

    context.primaryFile = root.primary_file?.path
      ? normalizePath(root.primary_file.path)
      : undefined;
    const primaryText = this.extractCDataValue(root.primary_file, '    ');
    if (primaryText) {
      context.primaryText = primaryText;
    }

    const relatedFiles = this.extractRelatedFiles(root.related_files);
    if (relatedFiles.length) {
      context.relatedFiles = relatedFiles;
    }

    context.rgSnippets = this.extractSnippets(root.code_snippets);

    const diffs = this.extractDiffs(root);
    Object.assign(context, diffs);

    const untrackedFiles = this.extractUntrackedFiles(root.untracked_files);
    if (untrackedFiles.length) {
      context.untrackedFiles = untrackedFiles;
    }

    const analysisAst = this.extractAnalysis(root.analysis?.ast);
    if (analysisAst) {
      context.analysis = { ast: analysisAst };
    }

    return context;
  }
}
