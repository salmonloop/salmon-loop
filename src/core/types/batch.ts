import type { LoopOptions, LoopResult } from './loop.js';
import type { TokenUsage } from './usage.js';

export interface DimensionStats {
  total: number;
  success: number;
  failed: number;
  avgDurationMs: number;
  totalUsage: TokenUsage;
}

export interface BatchRunReport {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  successRate: number;
  avgDurationMs: number;
  results: LoopResult[];
  totalUsage: TokenUsage;
  byDimension(dimension: string): Record<string, DimensionStats>;
}

export interface BatchRunOptions {
  rateLimitMs?: number;
  filter?: (options: LoopOptions) => boolean;
  signal?: AbortSignal;
}
