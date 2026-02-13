import { readFile } from 'fs/promises';
import path from 'path';

import { text } from '../../../locales/index.js';
import { AstParser } from '../../ast/parser.js';
import { LIMITS } from '../../config/limits.js';
import { logger } from '../../observability/logger.js';
import type { CodeLocation, RelatedFileContext, SymbolInfo } from '../../types/index.js';
import { safeJoin } from '../../utils/path.js';
import { extractImportSpecifiers } from '../ast/import-extractor.js';
import { resolveImportCandidates } from '../ast/module-resolver.js';
import { outlineSource } from '../ast/source-outline.js';
import type { ContextRequest } from '../types.js';

export interface AstResult {
  symbols: SymbolInfo[];
  definitionMap: Record<string, CodeLocation>;
  relatedFiles: RelatedFileContext[];
}

function getLanguageFromFile(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.java':
      return 'java';
    case '.cpp':
    case '.cc':
    case '.h':
      return 'cpp';
    case '.c':
      return 'c';
    default:
      return undefined;
  }
}

export class AstGatherer {
  async gather(primaryText: string | undefined, req: ContextRequest): Promise<AstResult> {
    if (!primaryText || !req.primaryFile) {
      return { symbols: [], definitionMap: {}, relatedFiles: [] };
    }

    const symbolsResult = await this.gatherSymbols(primaryText, req.primaryFile);
    const relatedFiles = await this.gatherImportedFiles(primaryText, req);

    return {
      symbols: symbolsResult.symbols,
      definitionMap: symbolsResult.definitionMap,
      relatedFiles,
    };
  }

  private async gatherSymbols(
    primaryText: string,
    primaryFile: string,
  ): Promise<Pick<AstResult, 'symbols' | 'definitionMap'>> {
    try {
      const lang = getLanguageFromFile(primaryFile);
      if (!lang) return { symbols: [], definitionMap: {} };

      const tree = await AstParser.parse(primaryText, lang);
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

  private async gatherImportedFiles(
    primaryText: string,
    req: ContextRequest,
  ): Promise<RelatedFileContext[]> {
    const specifiers = extractImportSpecifiers(primaryText);
    const relative = specifiers.filter((s) => s.startsWith('.'));

    const related: RelatedFileContext[] = [];
    const seen = new Set<string>();

    for (const spec of relative) {
      const candidates = resolveImportCandidates({
        currentFile: req.primaryFile!,
        specifier: spec,
      });
      if (candidates.length === 0) continue;

      const resolved = await this.pickFirstExisting(req, candidates);
      if (!resolved) continue;

      const normalized = resolved.replace(/^(\.\/|\/)+/, '');
      if (seen.has(normalized)) continue;
      if (normalized === req.primaryFile) continue;
      seen.add(normalized);

      const content = await this.readRepoFile(req, normalized);
      if (content === null) continue;

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

    return related;
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
