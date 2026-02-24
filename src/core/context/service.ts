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
import { buildContextTargetsStep } from './steps/context-targets.js';
import type { ContextRequest, ContextResult, DiffScope } from './types.js';

export class ContextService {
  private readonly deps: ContextServiceDeps;
  private readonly cache = new Map<string, ContextResult>();
  private readonly updaters = new Map<string, IncrementalUpdater>();
  private readonly promptCachingManager: PromptCachingManager;

  constructor(deps: Partial<ContextServiceDeps> = {}) {
    this.deps = { ...defaultContextServiceDeps(), ...deps };
    this.promptCachingManager = this.deps.promptCachingManager;
  }

  async build(req: ContextRequest): Promise<ContextResult> {
    const diffScope: DiffScope = req.diffScope ?? 'primary';

    const cacheKey = this.makeCacheKey(req);
    const cached = this.cache.get(cacheKey);
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
      .step('CONTEXT_BUDGET', buildContextBudgetStep(this.deps))
      .execute();
    if (!report.success) {
      throw report.error ?? new Error('Context pipeline failed');
    }
    const contextResult = report.data as ContextResult;
    this.cache.set(cacheKey, contextResult);
    this.recordContextDiff(cacheKey, contextResult);
    return contextResult;
  }

  private makeCacheKey(req: ContextRequest): string {
    const parts = [
      req.repoPath,
      req.snapshotHash ?? '',
      req.primaryFile ?? '',
      req.instruction ?? '',
      req.selection ?? '',
      req.diffScope ?? 'primary',
    ];
    return parts.join('::');
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
