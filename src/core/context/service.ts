import { createHash } from 'node:crypto';
import path from 'node:path';

import { FileAdapter } from '../adapters/fs/file-adapter.js';
import { Pipeline } from '../grizzco/engine/pipeline/pipeline.js';
import { logger } from '../observability/logger.js';

import { CONTEXT_AUDIT_ACTION, CONTEXT_AUDIT_PHASE } from './audit-constants.js';
import { recordContextAuditEvent } from './audit.js';
import { ContextDiff, IncrementalUpdater } from './cache/incremental-updater.js';
import type { PromptCachingManager } from './cache/prompt-caching.js';
import type { PromptCacheStats } from './cache/types.js';
import { createIntentSignature, createTargetSetSignature } from './hash.js';
import type { ContextServiceDeps } from './service-deps.js';
import { defaultContextServiceDeps } from './service-deps.js';
import { buildContextBudgetStep } from './steps/context-budget.js';
import { buildContextGatherStep } from './steps/context-gather.js';
import { buildContextPrimaryStep } from './steps/context-primary.js';
import { buildContextPromotionStep } from './steps/context-promotion.js';
import { buildContextTargetsStep } from './steps/context-targets.js';
import type { ContextRequest, ContextResult, DiffScope } from './types.js';

interface CacheEntry {
  result: ContextResult;
  trackedFiles: string[];
  signature: string;
  targetSetSignature?: string;
  intentSignature: string;
  createdAt?: number;
  lastAccessedAt?: number;
}

export class ContextService {
  private readonly deps: ContextServiceDeps;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly updaters = new Map<string, IncrementalUpdater>();
  private readonly promptCachingManager: PromptCachingManager;
  private readonly fileAdapter = new FileAdapter();
  private static readonly MAX_CACHE_TRACKED_FILES = 64;
  private static readonly DEFAULT_CACHE_MAX_ENTRIES = 256;
  private static readonly DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly cacheMaxEntries: number;
  private readonly cacheTtlMs: number;
  private readonly cacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(
    deps: Partial<ContextServiceDeps> = {},
    options?: { cacheMaxEntries?: number; cacheTtlMs?: number },
  ) {
    this.deps = { ...defaultContextServiceDeps(), ...deps };
    this.promptCachingManager = this.deps.promptCachingManager;
    this.cacheMaxEntries =
      options?.cacheMaxEntries && options.cacheMaxEntries > 0
        ? Math.floor(options.cacheMaxEntries)
        : ContextService.DEFAULT_CACHE_MAX_ENTRIES;
    this.cacheTtlMs =
      options?.cacheTtlMs && options.cacheTtlMs > 0
        ? Math.floor(options.cacheTtlMs)
        : ContextService.DEFAULT_CACHE_TTL_MS;
  }

  async build(req: ContextRequest): Promise<ContextResult> {
    const diffScope: DiffScope = req.diffScope ?? 'primary';
    const intentSignature = createIntentSignature({
      instruction: req.instruction,
      primaryFile: req.primaryFile,
      selection: req.selection,
      diffScope: req.diffScope,
    });

    const cacheKey = this.makeCacheKey(req, intentSignature);
    const cacheLookup = await this.getValidCachedResult(cacheKey, req.repoPath);
    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.cacheLookup,
      {
        cacheKey,
        intentSignature,
        targetSetSignature: cacheLookup.targetSetSignature,
        hit: Boolean(cacheLookup.result),
        missReason: cacheLookup.result ? undefined : cacheLookup.missReason,
      },
      { source: 'context', severity: 'low', scope: 'session', phase: CONTEXT_AUDIT_PHASE.primary },
    );
    const cached = cacheLookup.result;
    if (cached && !req.signal?.aborted) {
      logger.trace(`[CONTEXT_CACHE] hit ${cacheKey}`);
      return cached;
    }

    logger.trace(`  [CONTEXT] Building context for repo: ${req.repoPath}`);
    logger.trace(`  [CONTEXT] File: ${req.primaryFile}, Instruction: ${req.instruction}`);

    const report = await Pipeline.of({ req, diffScope })
      .step('CONTEXT_PRIMARY', buildContextPrimaryStep(this.deps))
      .step('CONTEXT_GATHER', buildContextGatherStep(this.deps))
      .step('CONTEXT_TARGETS', buildContextTargetsStep(this.deps))
      .step('CONTEXT_PROMOTION', buildContextPromotionStep(this.deps))
      .step('CONTEXT_BUDGET', buildContextBudgetStep(this.deps))
      .execute();
    if (!report.success) {
      throw report.error ?? new Error('Context pipeline failed');
    }
    const contextResult = report.data as ContextResult;
    const trackedFiles = this.collectTrackedFiles(req, contextResult);
    const signature = await this.computeTrackedFilesSignature(req.repoPath, trackedFiles);
    this.cache.set(cacheKey, {
      result: contextResult,
      trackedFiles,
      signature,
      targetSetSignature: contextResult.meta.targetSetSignature,
      intentSignature,
    });
    this.bumpCacheEntry(cacheKey);
    this.evictLruIfNeeded();
    this.recordContextDiff(cacheKey, contextResult);
    return contextResult;
  }

  private makeCacheKey(req: ContextRequest, intentSignature: string): string {
    const parts = [
      req.repoPath,
      req.snapshotHash ?? '',
      req.diffScope ?? 'primary',
      req.workspaceMode ?? 'direct',
      intentSignature,
    ];
    return parts.join('::');
  }

  private async getValidCachedResult(
    cacheKey: string,
    repoPath: string,
  ): Promise<{
    result?: ContextResult;
    missReason?: 'key_miss' | 'signature_mismatch' | 'target_signature_mismatch' | 'expired';
    targetSetSignature?: string;
  }> {
    this.evictExpiredEntries();
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      this.cacheMetrics.misses += 1;
      return { missReason: 'key_miss' };
    }
    if (this.isExpired(cacheKey, entry)) {
      this.cacheMetrics.misses += 1;
      return { missReason: 'expired' };
    }
    const expectedTargetSetSignature = createTargetSetSignature(entry.result.context.targets);
    const recordedTargetSetSignature =
      entry.targetSetSignature ??
      entry.result.meta.targetSetSignature ??
      expectedTargetSetSignature;
    if (recordedTargetSetSignature !== expectedTargetSetSignature) {
      this.cache.delete(cacheKey);
      this.cacheMetrics.misses += 1;
      return {
        missReason: 'target_signature_mismatch',
        targetSetSignature: expectedTargetSetSignature,
      };
    }
    const nextSignature = await this.computeTrackedFilesSignature(repoPath, entry.trackedFiles);
    if (nextSignature !== entry.signature) {
      this.cache.delete(cacheKey);
      this.cacheMetrics.misses += 1;
      return { missReason: 'signature_mismatch', targetSetSignature: expectedTargetSetSignature };
    }
    this.cacheMetrics.hits += 1;
    this.bumpCacheEntry(cacheKey);
    return { result: entry.result, targetSetSignature: expectedTargetSetSignature };
  }

  private collectTrackedFiles(req: ContextRequest, result: ContextResult): string[] {
    const deduped = new Set<string>();
    if (req.primaryFile) deduped.add(req.primaryFile);
    for (const file of result.meta.includedFiles ?? []) {
      if (file) deduped.add(file);
    }
    for (const target of result.context.targets ?? []) {
      if (target.path) deduped.add(target.path);
    }
    return [...deduped].sort().slice(0, ContextService.MAX_CACHE_TRACKED_FILES);
  }

  private async computeTrackedFilesSignature(repoPath: string, files: string[]): Promise<string> {
    const parts: string[] = [];
    for (const relativeFile of files) {
      const absoluteFile = path.resolve(repoPath, relativeFile);
      try {
        const stat = await this.fileAdapter.stat(absoluteFile);
        parts.push(`${relativeFile}:${stat.mtimeMs}:${stat.size}`);
      } catch {
        parts.push(`${relativeFile}:missing`);
      }
    }
    if (files.length === 0) {
      parts.push('files:none');
    }
    parts.push(...(await this.computeRepoStateSignatureParts(repoPath)));
    return createHash('sha1').update(parts.join('|')).digest('hex');
  }

  private async computeRepoStateSignatureParts(repoPath: string): Promise<string[]> {
    const gitFiles = ['.git/HEAD', '.git/index'];
    const parts: string[] = [];
    for (const rel of gitFiles) {
      const gitPath = path.resolve(repoPath, rel);
      try {
        const stat = await this.fileAdapter.stat(gitPath);
        parts.push(`${rel}:${stat.mtimeMs}:${stat.size}`);
      } catch {
        parts.push(`${rel}:missing`);
      }
    }
    return parts;
  }

  private getEntryTimestamp(entry: CacheEntry): number {
    return entry.lastAccessedAt ?? entry.createdAt ?? 0;
  }

  private bumpCacheEntry(cacheKey: string): void {
    const entry = this.cache.get(cacheKey);
    if (!entry) return;
    const now = Date.now();
    entry.createdAt = entry.createdAt ?? now;
    entry.lastAccessedAt = now;
    this.cache.set(cacheKey, entry);
  }

  private isExpired(cacheKey: string, entry: CacheEntry): boolean {
    const last = this.getEntryTimestamp(entry);
    if (!last || Date.now() - last <= this.cacheTtlMs) return false;
    this.cache.delete(cacheKey);
    this.cacheMetrics.evictions += 1;
    return true;
  }

  private evictExpiredEntries(): void {
    for (const [key, entry] of this.cache.entries()) {
      this.isExpired(key, entry);
    }
  }

  private evictLruIfNeeded(): void {
    while (this.cache.size > this.cacheMaxEntries) {
      let victimKey: string | undefined;
      let victimTs = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.cache.entries()) {
        const ts = this.getEntryTimestamp(entry);
        if (ts < victimTs) {
          victimTs = ts;
          victimKey = key;
        }
      }
      if (!victimKey) break;
      this.cache.delete(victimKey);
      this.cacheMetrics.evictions += 1;
    }
  }

  getCacheStats(): {
    size: number;
    maxEntries: number;
    ttlMs: number;
    hits: number;
    misses: number;
    evictions: number;
    hitRate: number;
  } {
    const total = this.cacheMetrics.hits + this.cacheMetrics.misses;
    const hitRate = total > 0 ? this.cacheMetrics.hits / total : 0;
    return {
      size: this.cache.size,
      maxEntries: this.cacheMaxEntries,
      ttlMs: this.cacheTtlMs,
      hits: this.cacheMetrics.hits,
      misses: this.cacheMetrics.misses,
      evictions: this.cacheMetrics.evictions,
      hitRate,
    };
  }

  private recordContextDiff(key: string, contextResult: ContextResult): void {
    const updater = this.getUpdater(key);
    const diff = updater.computeDiff(contextResult.context);
    this.logDiff(key, diff);
    this.logPromptCacheStats(key);
  }

  private getUpdater(key: string): IncrementalUpdater {
    let updater = this.updaters.get(key);
    if (!updater) {
      updater = new IncrementalUpdater();
      this.updaters.set(key, updater);
    }
    return updater;
  }

  private logDiff(key: string, diff: ContextDiff): void {
    if (!diff.addedFiles.length && !diff.modifiedFiles.length && !diff.removedFiles.length) {
      return;
    }
    logger.trace(
      `[CONTEXT_CACHE] ${key} diff added=${diff.addedFiles.length} modified=${diff.modifiedFiles.length} removed=${diff.removedFiles.length}`,
    );
  }

  private logPromptCacheStats(key: string): void {
    const stats: PromptCacheStats = this.promptCachingManager.getStats();
    logger.trace(
      `[PROMPT_CACHE] ${key} provider=${stats.provider} hitRate=${(stats.cacheHitRate * 100).toFixed(1)}% cachedTokens=${stats.cachedTokens}`,
    );
  }
}
