import { FileAdapter } from '../adapters/fs/file-adapter.js';
import { defaultPathAdapter } from '../adapters/path/path-adapter.js';
import { LIMITS } from '../config/limits.js';
import { resolveConfig } from '../config/resolve.js';
import { pluginRegistry } from '../plugin/registry.js';
import { ErrorType, type Context, type RunOptions } from '../types/index.js';
import { ensureInSandbox, normalizePath } from '../utils/path.js';

/**
 * Base extensions that should always be recognized for error file extraction.
 * These are common config and documentation files that may appear in any project.
 */
const BASE_EXTENSIONS = ['json', 'md', 'txt', 'yaml', 'yml', 'toml', 'lock', 'log'];

/**
 * Build dynamic file extension pattern for regex matching.
 * Combines plugin-registered extensions with base extensions for robustness.
 * Returns extensions without leading dots for regex alternation: (?:ts|js|tsx|...)
 */
function getExtensionsPattern(): string {
  const extensions = new Set<string>(BASE_EXTENSIONS);
  const plugins = pluginRegistry.getAll();

  for (const plugin of plugins) {
    for (const ext of plugin.meta.extensions) {
      // Strip leading dot for regex alternation
      extensions.add(ext.startsWith('.') ? ext.slice(1) : ext);
    }
  }

  return Array.from(extensions).join('|');
}

/**
 * Cached extension pattern for extractFailedFiles regex construction.
 * Cache on module load to avoid repeated plugin iteration.
 */
let cachedExtensionPattern: string | null = null;
const fileAdapter = new FileAdapter();

// Invalidate the cached regex when plugin registry changes so new extensions are recognized.
pluginRegistry.onChange(() => {
  cachedExtensionPattern = null;
});

function getCachedExtensionsPattern(): string {
  if (cachedExtensionPattern === null) {
    cachedExtensionPattern = getExtensionsPattern();
  }
  return cachedExtensionPattern;
}

import { outlineSource } from './ast/source-outline.js';
import { createContextCacheStore } from './cache/store-factory.js';
import { applySmartCompression } from './compression/smart-compress.js';
import { findFileDependencies } from './dependencies.js';
import {
  buildContextBudgetPolicyPlan,
  executeContextBudgetPolicyPlan,
} from './policies/budget-policy.js';
import { packUntilFull } from './policies/pack-until-full.js';
import { rankContextForRelevance } from './scoring/relevance.js';
import { calculateSectionChars } from './service-helpers.js';
import { ContextService } from './service.js';
import type { ContextResult } from './types.js';

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

function mergeTargets(
  existing: Context['targets'] | undefined,
  failedFiles: string[],
): NonNullable<Context['targets']> {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map((t) => normalizePath(t.path).replace(/^(\.\/|\/)+/, '')));

  for (const file of failedFiles) {
    const normalized = normalizePath(file).replace(/^(\.\/|\/)+/, '');
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      path: normalized,
      reason: 'failed_file',
      confidence: 'high',
      evidence: 'verify_output',
    });
  }

  return out;
}

async function readRepoFileText(repoPath: string, relativePath: string): Promise<string | null> {
  try {
    const normalized = normalizePath(relativePath).replace(/^(\.\/|\/)+/, '');
    const fullPath = ensureInSandbox(repoPath, defaultPathAdapter.join(repoPath, normalized));
    return await fileAdapter.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

export class ContextBuilder {
  static async build(options: RunOptions): Promise<ContextResult> {
    const config = await resolveConfig({ repoRoot: options.repoPath });
    const cacheConfig = createContextCacheStore(options.repoPath, config.raw);
    const service = new ContextService(
      {},
      {
        cacheStore: cacheConfig.store,
        cacheMaxEntries: cacheConfig.maxEntries,
        cacheTtlMs: cacheConfig.ttlMs,
      },
    );
    const result = await service.build({
      instruction: options.instruction,
      repoPath: options.repoPath,
      primaryFile: options.file,
      selection: options.selection,
      snapshotHash: options.snapshotHash,
      checkpointManager: options.checkpointManager,
      signal: options.signal,
    });

    return result;
  }

  private static tuneContext(context: Context, budgetChars: number): Context {
    return rankContextForRelevance(applySmartCompression(context, { budgetChars }));
  }

  private static packRankedContext(context: Context, budgetChars: number): Context {
    const preBudgetSectionChars = calculateSectionChars(context);
    const plan = buildContextBudgetPolicyPlan({
      requestedBudgetChars: budgetChars,
      preBudgetSectionChars,
      targetCount: (context.targets ?? []).length,
    });
    const packed = executeContextBudgetPolicyPlan({
      plan,
      context,
      fallbackBudgetChars: budgetChars,
      pack: packUntilFull,
    });
    return packed.context;
  }

  private static tuneAndPackContext(context: Context, budgetChars: number): Context {
    const tuned = this.tuneContext(context, budgetChars);
    return this.packRankedContext(tuned, budgetChars);
  }

  /**
   * Extract potential failed file paths from verification output.
   * Uses dynamically registered extensions from plugin registry.
   */
  static extractFailedFiles(verifyOutput: string): string[] {
    const uniqueFiles = new Set<string>();

    // Build extension pattern dynamically from registered plugins
    const extPattern = getCachedExtensionsPattern();

    // Strategy 1: Look for file paths followed by line numbers (common in stack traces and compiler output)
    // We handle both quoted and unquoted paths.
    const patterns = [
      // Quoted paths (can contain spaces)
      new RegExp(`"([^"\\n]+\\.(?:${extPattern}))"[:(]\\d+`, 'gu'),
      // Unquoted paths (no spaces allowed to avoid over-matching)
      new RegExp(`((?:[a-zA-Z]:)?[^\\s:()"]+\\.(?:${extPattern}))[:(]\\d+`, 'gu'),
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
    const pathPattern = new RegExp(
      `(?:^|\\s)((?:[a-zA-Z]:)?[^\\s:()"]+\\.(?:${extPattern}))\\b`,
      'gu',
    );
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
    const budgetChars = LIMITS.maxContextChars;
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
        targets: mergeTargets(context.targets, normalizedFailed),
      };

      const tuned = this.tuneContext(shrunkContext, budgetChars);

      // Protection against over-shrinking: if shrunk context is too small,
      // fallback to original context (but still truncated to max budget)
      if (this.calculateTotalChars(tuned) < LIMITS.minContextChars) {
        return this.tuneAndPackContext(context, budgetChars);
      }

      return this.packRankedContext(tuned, budgetChars);
    }

    // If no failed files, keep original keyword matches but ensure they are within limits
    return this.tuneAndPackContext(context, budgetChars);
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
