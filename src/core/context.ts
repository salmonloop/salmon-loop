import { readFile } from 'fs/promises';
import path from 'path';

import { outlineSource } from './context/ast/source-outline.js';
import { applySmartCompression } from './context/compression/smart-compress.js';
import { rankContextForRelevance } from './context/scoring/relevance.js';
import { ContextService } from './context/service.js';
import { findFileDependencies } from './dependency.js';
import { LIMITS } from './limits.js';
import { ensureInSandbox, normalizePath } from './path.js';
import { ErrorType, type Context, type RipgrepResult, type RunOptions } from './types.js';

export interface ShrinkContextOptions {
  errorType?: ErrorType;
  dependencyDepth?: number;
}

function toShrinkOptions(value?: ErrorType | ShrinkContextOptions): ShrinkContextOptions {
  if (!value) return {};
  if (typeof value === 'object') return value;
  return { errorType: value };
}

function uniqNormalizedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const normalized = normalizePath(p).replace(/^(\.\/|\/)+/, '');
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function readRepoFileText(repoPath: string, relativePath: string): Promise<string | null> {
  try {
    const normalized = normalizePath(relativePath).replace(/^(\.\/|\/)+/, '');
    const fullPath = ensureInSandbox(repoPath, path.join(repoPath, normalized));
    return await readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

export class ContextBuilder {
  static async build(options: RunOptions): Promise<Context> {
    const service = new ContextService();
    const result = await service.build({
      instruction: options.instruction,
      repoPath: options.repoPath,
      primaryFile: options.file,
      selection: options.selection,
      snapshotHash: options.snapshotHash,
      checkpointManager: options.checkpointManager,
    });

    return result.context;
  }

  /**
   * Truncates context to fit within character limits.
   * Priority: primaryText > rgSnippets > gitDiff
   * NOTE: gitDiff is currently dropped if context exceeds limits to reduce noise.
   * Truncation strategy: Pack-until-full (keep complete snippets until budget is reached).
   */
  private static truncateContext(context: Context): Context {
    const totalChars = this.calculateTotalChars(context);

    if (totalChars <= LIMITS.maxContextChars) {
      return context;
    }

    // Prioritize primaryText, then pack snippets until budget is reached
    let remainingChars = LIMITS.maxContextChars - (context.primaryText?.length || 0);

    if (remainingChars <= 0) {
      return {
        ...context,
        relatedFiles: [],
        rgSnippets: [],
        gitDiff: undefined,
      };
    }

    const truncatedRelated: any[] = [];
    for (const file of context.relatedFiles ?? []) {
      const len = file.content?.length ?? 0;
      if (len <= remainingChars) {
        truncatedRelated.push(file);
        remainingChars -= len;
        continue;
      }

      const outline = file.outline;
      if (outline && outline.length <= remainingChars && outline.length >= LIMITS.minSnippetChars) {
        truncatedRelated.push({
          ...file,
          mode: 'outline',
          content: outline,
          outline: undefined,
        });
        remainingChars -= outline.length;
        continue;
      }

      if (remainingChars >= LIMITS.minSnippetChars) {
        truncatedRelated.push({
          ...file,
          mode: 'outline',
          content: file.content.substring(0, remainingChars),
          outline: undefined,
        });
        remainingChars = 0;
      }
      break;
    }

    const truncatedSnippets: RipgrepResult[] = [];
    for (const snippet of context.rgSnippets) {
      const snippetLen = snippet.content?.length ?? 0;
      if (snippetLen <= remainingChars) {
        truncatedSnippets.push(snippet);
        remainingChars -= snippetLen;
      } else {
        // Only truncate the last one if it provides meaningful content
        if (remainingChars >= LIMITS.minSnippetChars) {
          truncatedSnippets.push({
            ...snippet,
            content: snippet.content.substring(0, remainingChars),
          });
        }
        break;
      }
    }

    return {
      ...context,
      relatedFiles: truncatedRelated,
      rgSnippets: truncatedSnippets,
      gitDiff: undefined,
    };
  }

  /**
   * Extract potential failed file paths from verification output
   */
  static extractFailedFiles(verifyOutput: string): string[] {
    const uniqueFiles = new Set<string>();

    // Strategy 1: Look for file paths followed by line numbers (common in stack traces and compiler output)
    // We handle both quoted and unquoted paths.
    const patterns = [
      // Quoted paths (can contain spaces)
      /"([^"\n]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))"[:(]\d+/gu,
      // Unquoted paths (no spaces allowed to avoid over-matching)
      /((?:[a-zA-Z]:)?[^\s:()"]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))[:(]\d+/gu,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(verifyOutput)) !== null) {
        let p = normalizePath(match[1].trim());
        p = p.replace(/^(\.\/|\/)/, '');
        p = p.replace(/^[a-zA-Z]:\//, '');
        uniqueFiles.add(p);
      }
    }

    // Strategy 2: Fall back to general file path matching for paths without line numbers
    const pathPattern =
      /(?:^|\s)((?:[a-zA-Z]:)?[^\s:()"]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))\b/gu;
    let match2;
    while ((match2 = pathPattern.exec(verifyOutput)) !== null) {
      let p = normalizePath(match2[1].trim());
      p = p.replace(/^(\.\/|\/)/, '');
      p = p.replace(/^[a-zA-Z]:\//, '');
      uniqueFiles.add(p);
    }

    // Filter out node_modules and .git
    return Array.from(uniqueFiles).filter(
      (file) => !file.includes('node_modules') && !file.startsWith('.git'),
    );
  }

  /**
   * Shrink context based on failed files, error type and token limits.
   * Uses deterministic rules: failed files + limited static dependencies.
   * Protects against over-shrinking by falling back to original context if budget allows.
   */
  static async shrinkContext(
    context: Context,
    failedFiles: string[],
    errorTypeOrOptions?: ErrorType | ShrinkContextOptions,
  ): Promise<Context> {
    const options = toShrinkOptions(errorTypeOrOptions);
    const dependencyDepth = Math.max(
      1,
      Math.min(LIMITS.maxDependencyDepth, options.dependencyDepth ?? 1),
    );

    // Normalize failed file paths
    const normalizedFailed = uniqNormalizedPaths(failedFiles);

    if (normalizedFailed.length > 0) {
      const dependencyPromises = normalizedFailed.map((f) =>
        findFileDependencies(f, context.repoPath, {
          depth: dependencyDepth,
          maxFiles: LIMITS.maxRelatedFiles,
        }).catch(() => []),
      );
      const dependenciesArrays = await Promise.all(dependencyPromises);
      const dependencyList = uniqNormalizedPaths(dependenciesArrays.flat());

      const selectedPaths = uniqNormalizedPaths([
        ...normalizedFailed,
        ...dependencyList.slice(0, LIMITS.maxRelatedFiles),
      ]);

      const existingByPath = new Map<string, any>();
      for (const f of context.relatedFiles ?? []) {
        existingByPath.set(normalizePath(f.path), f);
      }

      const newRelatedFiles: any[] = [];
      for (const p of selectedPaths) {
        if (p === context.primaryFile) continue;

        const existing = existingByPath.get(normalizePath(p));
        if (existing) {
          newRelatedFiles.push({
            ...existing,
            kind: normalizedFailed.includes(p) ? 'failed' : 'dependency',
          });
          continue;
        }

        const content = await readRepoFileText(context.repoPath, p);
        if (content === null) continue;

        const isLarge = content.length > LIMITS.largeFileThresholdBytes;
        const outline = outlineSource(content);

        newRelatedFiles.push({
          path: p,
          kind: normalizedFailed.includes(p) ? 'failed' : 'dependency',
          mode: isLarge ? 'outline' : 'full',
          content: isLarge ? outline : content,
          outline: isLarge ? undefined : outline || undefined,
        });
      }

      let newSnippets = context.rgSnippets.filter((snippet) => {
        const normalizedSnippetFile = normalizePath(snippet.file);
        return selectedPaths.some((related) => normalizedSnippetFile.endsWith(related));
      });

      // Cap snippets after shrink to keep context focused
      newSnippets = newSnippets.slice(0, LIMITS.maxSnippetsAfterShrink);

      const shrunkContext: Context = {
        ...context,
        relatedFiles: newRelatedFiles,
        rgSnippets: newSnippets,
      };

      const tuned = rankContextForRelevance(applySmartCompression(shrunkContext));

      // Protection against over-shrinking: if shrunk context is too small,
      // fallback to original context (but still truncated to max budget)
      if (this.calculateTotalChars(tuned) < LIMITS.minContextChars) {
        return this.truncateContext(context);
      }

      return tuned;
    }

    // If no failed files, keep original keyword matches but ensure they are within limits
    return this.truncateContext(context);
  }

  /**
   * Calculates approximate context size in characters.
   * NOTE: This is NOT token count. Used only for heuristic limits and shrinking.
   */
  private static calculateTotalChars(context: Context): number {
    const primary = context.primaryText?.length ?? 0;
    const related =
      context.relatedFiles?.reduce((sum, file) => sum + (file.content?.length ?? 0), 0) ?? 0;
    const snippets = context.rgSnippets.reduce(
      (sum, snippet) => sum + (snippet.content?.length ?? 0),
      0,
    );
    const diff =
      (context.gitDiff?.length ?? 0) +
      (context.stagedDiff?.length ?? 0) +
      (context.unstagedDiff?.length ?? 0) +
      (context.untrackedDiff?.length ?? 0);

    return primary + related + snippets + diff;
  }
}
