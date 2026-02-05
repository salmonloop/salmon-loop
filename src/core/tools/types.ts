import { z } from 'zod';

import { ExecutionPhase } from '../types.js';

import { ResourceKey } from './parallel/resources.js';

export { ExecutionPhase };

export type ToolSource = 'builtin' | 'mcp' | 'plugin';
export type RiskLevel = 'low' | 'medium' | 'high';

export type SideEffect =
  | 'none'
  | 'fs_read'
  | 'fs_write'
  | 'process'
  | 'network'
  | 'git_read'
  | 'git_write'
  | 'snapshot_mutate';

export type ConcurrencyHint =
  | 'parallel_ok' // Explicitly parallelizable (usually read-only)
  | 'serial_only' // Must be serial (write-heavy or non-deterministic)
  | 'mutex_by_resource' // Controlled by resource locks
  | 'isolated'; // Requires isolated environment (sandbox/temp dir)

export interface ToolRuntimeCtx {
  repoRoot: string;
  /**
   * Optional base repository path used for internal persistence (audit logs, plan state, etc.).
   * When running in worktree strategy, repoRoot/worktreeRoot may point at the shadow worktree,
   * while persistenceRoot should point at the user's base repository.
   */
  persistenceRoot?: string;
  worktreeRoot?: string;
  attemptId: number;
  dryRun: boolean;
  model?: string;
  env?: Record<string, string>;
  phase?: ExecutionPhase;
}

export interface ToolSpec<I = any, O = any> {
  name: string; // e.g. "code.search"
  source: ToolSource; // builtin/mcp/plugin
  description: string;

  riskLevel: RiskLevel;
  sideEffects: SideEffect[];
  concurrency: ConcurrencyHint;
  allowedPhases: ExecutionPhase[];
  defaultTimeoutMs?: number;

  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;

  computeResources?: (args: I, ctx: ToolRuntimeCtx) => ResourceKey[];
  executor: (input: I, ctx: ToolRuntimeCtx) => Promise<O>;
}

export interface ToolCallEnvelope {
  id: string;
  phase: ExecutionPhase; // host inject; model cannot set
  toolName: string; // matches ToolSpec.name
  args: unknown;

  ctx: ToolRuntimeCtx;
}

export interface ToolResult {
  id: string;
  toolName: string;
  source: ToolSource;
  status: 'ok' | 'denied' | 'error' | 'timeout';

  output?: unknown; // only if outputSchema passes
  summary?: string; // sanitized, truncated
  outputSummary?: string;
  meta?: Record<string, any>;
  durationMs?: number;

  error?: {
    code: string;
    message: string;
    retryable: boolean;
    failurePhase?: ExecutionPhase;
  };
}
