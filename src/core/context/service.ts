import { createHash } from 'node:crypto';
import path from 'node:path';

import { FileAdapter } from '../adapters/fs/file-adapter.js';
import { Pipeline } from '../grizzco/engine/pipeline/pipeline.js';
import { logger } from '../observability/logger.js';

import { ContextDiff, IncrementalUpdater } from './cache/incremental-updater.js';
import type { PromptCachingManager } from './cache/prompt-caching.js';
import type { PromptCacheStats } from './cache/types.js';
import type { ContextServiceDeps } from './service-deps.js';
import { defaultContextServiceDeps } from './service-deps.js';
import { buildContextBudgetStep } from './steps/context-budget.js';
import { buildContextGatherStep } from './steps/context-gather.js';
import { buildContextPrimaryStep } from './steps/context-primary.js';
import { buildContextPromotionStep } from './steps/context-promotion.js';
import { buildContextTargetsStep } from './steps/context-targets.js';
import type { ContextRequest, ContextResult, DiffScope } from './types.js';

export class ContextService {
  private readonly deps: ContextServiceDeps;
  private readonly cache = new Map<
    string,
    { result: ContextResult; trackedFiles: string[]; signature: string }
  >();
  private readonly updaters = new Map<string, IncrementalUpdater>();
  private readonly promptCachingManager: PromptCachingManager;
  private readonly fileAdapter = new FileAdapter();
  private static readonly MAX_CACHE_TRACKED_FILES = 64;

  constructor(deps: Partial<ContextServiceDeps> = {}) {
    this.deps = { ...defaultContextServiceDeps(), ...deps };
    this.promptCachingManager = this.deps.promptCachingManager;
  }

  async build(req: ContextRequest): Promise<ContextResult> {
    const diffScope: DiffScope = req.diffScope ?? 'primary';

    const cacheKey = await this.makeCacheKey(req);
    const cached = await this.getValidCachedResult(cacheKey, req.repoPath);
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
    this.cache.set(cacheKey, { result: contextResult, trackedFiles, signature });
    this.recordContextDiff(cacheKey, contextResult);
    return contextResult;
  }

  private async makeCacheKey(req: ContextRequest): Promise<string> {
    const parts = [
      req.repoPath,
      req.snapshotHash ?? '',
      req.primaryFile ?? '',
      req.instruction ?? '',
      req.selection ?? '',
      req.diffScope ?? 'primary',
      req.workspaceMode ?? 'direct',
    ];
    const fingerprint = await this.computeRequestFingerprint(req);
    return [...parts, fingerprint].join('::');
  }

  private async computeRequestFingerprint(req: ContextRequest): Promise<string> {
    if (req.snapshotHash) {
      return `snapshot:${req.snapshotHash}`;
    }

    if (!req.primaryFile) {
      return 'primary:none';
    }

    const absolutePath = path.resolve(req.repoPath, req.primaryFile);
    try {
      const content = await this.fileAdapter.readFile(absolutePath, 'utf-8');
      return createHash('sha1').update(content, 'utf-8').digest('hex');
    } catch {
      return `missing:${absolutePath}`;
    }
  }

  private async getValidCachedResult(
    cacheKey: string,
    repoPath: string,
  ): Promise<ContextResult | undefined> {
    const entry = this.cache.get(cacheKey);
    if (!entry) return undefined;
    const nextSignature = await this.computeTrackedFilesSignature(repoPath, entry.trackedFiles);
    if (nextSignature !== entry.signature) {
      this.cache.delete(cacheKey);
      return undefined;
    }
    return entry.result;
  }

  private collectTrackedFiles(req: ContextRequest, result: ContextResult): string[] {
    const deduped = new Set<string>();
    if (req.primaryFile) deduped.add(req.primaryFile);
    for (const file of result.meta.includedFiles ?? []) {
      if (file) deduped.add(file);
    }
    return [...deduped].sort().slice(0, ContextService.MAX_CACHE_TRACKED_FILES);
  }

  private async computeTrackedFilesSignature(repoPath: string, files: string[]): Promise<string> {
    if (files.length === 0) return 'files:none';
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
    return createHash('sha1').update(parts.join('|')).digest('hex');
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
