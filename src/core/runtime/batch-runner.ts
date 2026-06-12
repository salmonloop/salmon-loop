import type { BatchRunOptions, BatchRunReport, DimensionStats } from '../types/batch.js';
import type { LoopOptions, LoopResult } from '../types/loop.js';
import type { TokenUsage } from '../types/usage.js';

import { createRunSalmonLoop } from './loop.js';
import type { Semaphore } from './semaphore.js';

export class BatchRunner {
  private readonly runLoop: (options: LoopOptions) => Promise<LoopResult>;

  constructor(deps?: { semaphore?: Semaphore }) {
    this.runLoop = createRunSalmonLoop({ semaphore: deps?.semaphore });
  }

  async run(tasks: LoopOptions[], batchOptions?: BatchRunOptions): Promise<BatchRunReport> {
    const { rateLimitMs = 0, filter, signal } = batchOptions ?? {};
    const filtered = filter ? tasks.filter(filter) : tasks;
    const results: LoopResult[] = [];

    for (let i = 0; i < filtered.length; i++) {
      if (signal?.aborted) break;
      if (i > 0 && rateLimitMs > 0) {
        await new Promise((r) => setTimeout(r, rateLimitMs));
      }
      const result = await this.runLoop(filtered[i]);
      results.push(result);
    }

    return buildBatchRunReport(results);
  }
}

function aggregateUsage(results: LoopResult[]): TokenUsage {
  const total: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 };
  for (const r of results) {
    if (!r.usage) continue;
    total.inputTokens += r.usage.inputTokens;
    total.outputTokens += r.usage.outputTokens;
    total.totalTokens += r.usage.totalTokens;
    if (r.usage.estimatedCost) total.estimatedCost! += r.usage.estimatedCost;
  }
  return total;
}

export function buildBatchRunReport(results: LoopResult[]): BatchRunReport {
  const completed = results.filter((r) => r.success).length;
  const failed = results.length - completed;
  const totalDuration = results.reduce((s, r) => s + (r.durationMs ?? 0), 0);

  return {
    totalRuns: results.length,
    completedRuns: completed,
    failedRuns: failed,
    successRate: results.length > 0 ? completed / results.length : 0,
    avgDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    results,
    totalUsage: aggregateUsage(results),
    byDimension: (dimension: string) => buildDimensionMap(results, dimension),
  };
}

function buildDimensionMap(
  results: LoopResult[],
  dimension: string,
): Record<string, DimensionStats> {
  const map: Record<string, DimensionStats> = {};
  for (const r of results) {
    const value = String((r.providerMeta as Record<string, unknown>)?.[dimension] ?? 'unknown');
    map[value] ??= {
      total: 0,
      success: 0,
      failed: 0,
      avgDurationMs: 0,
      totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    const bucket = map[value];
    bucket.total++;
    if (r.success) bucket.success++;
    else bucket.failed++;
    if (r.durationMs) bucket.avgDurationMs += r.durationMs;
    if (r.usage) {
      bucket.totalUsage.inputTokens += r.usage.inputTokens;
      bucket.totalUsage.outputTokens += r.usage.outputTokens;
      bucket.totalUsage.totalTokens += r.usage.totalTokens;
    }
  }
  for (const bucket of Object.values(map)) {
    bucket.avgDurationMs = bucket.total > 0 ? bucket.avgDurationMs / bucket.total : 0;
  }
  return map;
}
