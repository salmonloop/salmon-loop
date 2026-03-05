import { z } from 'zod';

import type { PluginRegistry } from '../plugin/registry.js';
import type { SubAgentControllerPort } from '../sub-agent/controller.js';
import type { LLM } from '../types/llm.js';
import type { ExecutionPhase, UserInputProvider } from '../types/runtime.js';

import { ResourceKey } from './parallel/resources.js';

export type { ExecutionPhase };

export type ToolSource = 'builtin' | 'mcp' | 'plugin';
export type RiskLevel = 'low' | 'medium' | 'high';

export type SideEffect =
  | 'none'
  | 'fs_read'
  | 'fs_write'
  | 'runtime_write'
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
  signal?: AbortSignal;
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
  userInputProvider?: UserInputProvider;
  agentKind?: 'primary' | 'subagent';
  /**
   * Language plugin registry used for AST parsing and language-aware helpers.
   */
  languagePlugins?: PluginRegistry;
  /**
   * Optional sub-agent controller shared across the current host process.
   * This is host-only state and is not exposed to the model.
   */
  subAgentController?: SubAgentControllerPort;
  /**
   * Optional runtime LLM reference for internal orchestration tools (e.g., sub-agent dispatch).
   * This is not exposed to the model; it is a host-only in-process reference.
   */
  llm?: LLM;
}

export const TOOL_INTENTS = ['READ', 'SEARCH', 'LIST', 'WRITE', 'INFRA', 'AGENT'] as const;
export type ToolIntent = (typeof TOOL_INTENTS)[number];

export interface ToolSpecDescriptor {
  name: string; // e.g. "code.search"
  source: ToolSource; // builtin/mcp/plugin
  intent: ToolIntent; // Semantic intent of the tool
  description: string;
}

export interface ToolSpecGovernance {
  riskLevel: RiskLevel;
  sideEffects: SideEffect[];
  concurrency: ConcurrencyHint;
  allowedPhases: ExecutionPhase[];
  defaultTimeoutMs?: number;
}

export interface ToolSpecSchemas<I = any, O = any> {
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;

  /**
   * Optional pre-authorization argument summarizer for high-risk tools.
   * This hook MUST be read-only and must not depend on network or process execution.
   * If it throws, the system falls back to the default JSON args summary.
   */
  summarizeArgsForAuthorization?: (args: I, ctx: ToolRuntimeCtx) => Promise<string | undefined>;
}

export interface ToolSpecRuntime<I = any, O = any> {
  computeResources?: (args: I, ctx: ToolRuntimeCtx) => ResourceKey[];
  executor: (input: I, ctx: ToolRuntimeCtx) => Promise<O>;
}

export interface ToolSpec<I = any, O = any>
  extends ToolSpecDescriptor, ToolSpecGovernance, ToolSpecSchemas<I, O>, ToolSpecRuntime<I, O> {}

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
