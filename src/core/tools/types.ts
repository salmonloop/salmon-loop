import { z } from 'zod';

import { ExecutionPhase } from '../types';
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
  | 'git_write';

export interface ToolRuntimeCtx {
  repoRoot: string;
  worktreeRoot?: string;
  attemptId: number;
  dryRun: boolean;
  model?: string;
}

export interface ToolSpec<I = any, O = any> {
  name: string; // e.g. "code.search"
  source: ToolSource; // builtin/mcp/plugin
  description: string;

  riskLevel: RiskLevel;
  sideEffects: SideEffect[];
  allowedPhases: ExecutionPhase[];
  defaultTimeoutMs?: number;

  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;

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
