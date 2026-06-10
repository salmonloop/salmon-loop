/**
 * Shared evaluation types for multi-provider eval harness.
 *
 * Each eval provider (salmon-loop, subprocess, harbor) implements the same
 * interface so the harness can run any provider through a unified CLI.
 */

// ─── Task Definition ───

export interface EvalTaskDefinition {
  id: string;
  instruction: string;
  repoPath?: string;
  /** Provider-specific metadata (Harbor instance config, profile, etc.) */
  providerMeta?: Record<string, unknown>;
  tags?: string[];
  timeoutMs?: number;
}

// ─── Result ───

export interface EvalResult {
  taskId: string;
  provider: string;
  success: boolean;
  reasonCode: string;
  attempts: number;
  durationMs: number;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Provider-specific metadata (agent counts, Harbor session IDs, etc.) */
  providerMeta?: Record<string, unknown>;
  error?: string;
}

// ─── Report ───

export interface EvalReport {
  provider: string;
  generatedAt: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  avgDurationMs: number;
  results: EvalResult[];
  /** Provider-specific supplement (byProfile, byComplexity, etc.) */
  supplement?: Record<string, unknown>;
}

// ─── Run Options ───

export interface EvalRunOptions {
  mode?: 'stub' | 'real';
  verbose?: boolean;
  filter?: (task: EvalTaskDefinition) => boolean;
  signal?: AbortSignal;
}

// ─── Provider Interface ───

export interface EvalProvider {
  readonly name: string;

  /** Load task definitions from provider-specific source. */
  loadTasks(source: string): Promise<EvalTaskDefinition[]>;

  /** Execute a single task, returning a normalized result. */
  runTask(task: EvalTaskDefinition, options: EvalRunOptions): Promise<EvalResult>;

  /** Optional: produce a provider-specific report supplement. */
  buildSupplement?(results: EvalResult[]): Record<string, unknown>;
}
