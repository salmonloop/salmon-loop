/**
 * High-performance XML to JSON context format converter
 * Optimized for token efficiency and performance
 */

import { XMLParser } from 'fast-xml-parser';

import type { AstSyntaxError, Context, ContextAnalysis, ContextTarget } from '../../types/index.js';

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

    return {
      c: jsonContext,
    };
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

  private static extractContextFromXML(_parsed: any): Context {
    throw new Error('XML parsing not implemented yet - this is expected in TDD');
  }
}
