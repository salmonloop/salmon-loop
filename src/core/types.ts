export type VerboseLevel = 'basic' | 'extended';
export type ApplyBackOnDirty = 'abort' | '3way';

/**
 * Single Source of Truth (SSOT) for Execution Phases.
 *
 * EXECUTION_PHASES (Array):
 * - Used for runtime iteration (e.g., CLI progress bars, validation loops).
 * - Ensures order and completeness.
 */
export const EXECUTION_PHASES = [
  'PREFLIGHT',
  'CONTEXT',
  'PLAN',
  'PATCH',
  'VALIDATE',
  'AST_VALIDATE',
  'APPLY',
  'VERIFY',
  'ROLLBACK',
  'SHRINK',
] as const;

/**
 * Phase (Object):
 * - Used for value access in code logic (e.g., `if (phase === Phase.PLAN)`).
 * - Eliminates "magic strings" and allows easy refactoring/renaming.
 */
export const Phase = {
  PREFLIGHT: 'PREFLIGHT',
  CONTEXT: 'CONTEXT',
  PLAN: 'PLAN',
  PATCH: 'PATCH',
  VALIDATE: 'VALIDATE',
  AST_VALIDATE: 'AST_VALIDATE',
  APPLY: 'APPLY',
  VERIFY: 'VERIFY',
  ROLLBACK: 'ROLLBACK',
  SHRINK: 'SHRINK',
} as const;

/**
 * ExecutionPhase (Type):
 * - Derived automatically from the array.
 * - Used for TypeScript type checking and function signatures.
 */
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export enum ErrorType {
  COMPILATION = 'compilation',
  LINT = 'lint',
  TEST = 'test',
  LOGIC = 'logic',
  DEPENDENCY_ERROR = 'dependency_error',
  RESOURCE_LOCK_ERROR = 'resource_lock_error',
  AST_VALIDATION_ERROR = 'ast_validation_error',
  UNKNOWN = 'unknown',
}

export interface Plan {
  goal: string;
  files: string[];
  changes: string[];
  verify: string;
}

export interface PlanStep {
  description: string;
  file: string;
}

export type LoopReasonCode =
  | 'PREFLIGHT_DIRTY'
  | 'PREFLIGHT_NOT_GIT'
  | 'DRY_RUN'
  | 'VERIFY_FAILED'
  | 'ROLLBACK_FAILED'
  | 'LOOP_FAILED'
  | 'MAX_RETRIES'
  | 'APPLY_BACK_FAILED'
  | 'LOOP_CRASH'
  | 'SUCCESS';

export interface LoopResult {
  success: boolean;
  reason: string;
  reasonCode: LoopReasonCode;
  attempts: number;
  logs: StepLog[];
  history?: LoopIteration[];
  finalPatch?: string;
  failurePhase?: ExecutionPhase;
  changedFiles?: string[];
  errorType?: ErrorType;
}

export interface LoopIteration {
  attempt: number;
  plan: Plan | null;
  patch: string | null;
  error?: string;
  contextSummary: string;
}

export interface StepLog {
  step: ExecutionPhase | 'error' | 'UNKNOWN';
  success: boolean;
  output: string;
  timestamp: Date;
}

/**
 * Events emitted during the SalmonLoop execution.
 */
export type LoopEvent =
  | { type: 'phase.start'; phase: ExecutionPhase; timestamp: Date }
  | { type: 'phase.end'; phase: ExecutionPhase; success: boolean; timestamp: Date }
  | {
      type: 'log';
      message: string;
      level: 'info' | 'warn' | 'error' | 'debug' | 'trace';
      timestamp: Date;
    }
  | {
      type: 'diff.meta';
      changedFiles: string[];
      fileCount: number;
      lineCount: number;
      timestamp: Date;
    }
  | { type: 'verify.result'; ok: boolean; output: string; timestamp: Date }
  | {
      type: 'retry';
      fromAttempt: number;
      toAttempt: number;
      reason: string;
      failedFiles: string[];
      timestamp: Date;
    }
  | {
      type: 'checkpoint.created';
      worktreePath: string;
      baseRef: string;
      timestamp: Date;
    }
  | {
      type: 'checkpoint.cleaned';
      ok: boolean;
      timestamp: Date;
    };

export interface CodeLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface SymbolInfo {
  name: string;
  kind: 'definition' | 'reference';
  location: CodeLocation;
  snippet?: string;
}

export interface Context {
  repoPath: string;
  primaryFile?: string;
  primaryText?: string;
  rgSnippets: RipgrepResult[];
  /**
   * @deprecated Use stagedDiff and unstagedDiff instead
   */
  gitDiff?: string;
  stagedDiff?: string;
  unstagedDiff?: string;
  untrackedDiff?: string;
  untrackedFiles?: string[];
  definitionMap?: Record<string, CodeLocation>;
  symbols?: SymbolInfo[];
}

export interface FileContext {
  path: string;
  content: string;
  selection?: string;
}

export interface RipgrepResult {
  file: string;
  line: number;
  content: string;
}

export interface RunOptions {
  instruction: string;
  verify: string;
  repoPath: string;
  file?: string;
  contextFiles?: string[];
  selection?: string;
  dryRun?: boolean;
  forceReset?: boolean;
  onEvent?: (event: LoopEvent) => void;
  verbose?: VerboseLevel;
  strategy?: CheckpointStrategy;
  applyBackOnDirty?: ApplyBackOnDirty;
  worktreePrepare?: string;
  expectedChanges?: string[];
  expectedFileContent?: { path: string; content: string }[];
  targetNodeName?: string;
  snapshotHash?: string; // ARCHITECTURE OPTIMIZATION: Pass snapshot hash for Git object reading
  checkpointManager?: import('./strata/checkpoint/manager.js').CheckpointManager; // ARCHITECTURE OPTIMIZATION: Pass manager instance for Git object reading
  checkpoint?: {
    strategy?: 'worktree';
    keepWorktreeOnFailure?: boolean;
    applyBack?: 'patch' | 'cherry-pick';
  };
}

export class SalmonError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class GitError extends SalmonError {
  constructor(
    message: string,
    public readonly command?: string,
    public readonly stderr?: string,
  ) {
    const fullMessage = stderr ? `${message}\nStderr: ${stderr}` : message;
    super(fullMessage, 'GIT_ERROR');
  }
}

export class DiffValidationError extends SalmonError {
  constructor(message: string) {
    super(message, 'DIFF_VALIDATION_FAILED');
  }
}

export type CheckpointStrategy = 'direct' | 'worktree' | 'tempCommit';

export interface CheckpointRef {
  strategy: 'worktree';
  repoPath: string;
  worktreePath: string;
  baseRef: string;
  branchName: string;
}

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMRole;
  content: string;
  name?: string; // For 'tool' role
  tool_calls?: any[]; // Raw tool calls from provider
  tool_call_id?: string; // For 'tool' role response
}

export interface LLMStreamChunk {
  role: LLMRole;
  /**
   * Text delta emitted by the provider. Consumers are responsible for concatenation.
   */
  contentDelta?: string;
  /**
   * Provider-native tool call deltas (optional, provider-dependent).
   */
  tool_calls?: any[];
  /**
   * Indicates the end of the stream.
   */
  done?: boolean;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
  stop?: string[];
  /**
   * Provider-native tool definitions.
   *
   * - For OpenAI: [{ type: 'function', function: { name, description, parameters } }]
   * - For other providers: ignored unless supported.
   */
  tools?: any[];
  /**
   * Provider-native tool choice directive.
   *
   * - For OpenAI: 'auto' | 'none' | { type: 'function', function: { name } }
   */
  toolChoice?: any;
}

export interface LLM {
  /**
   * Basic chat completion for multi-turn interaction
   */
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMMessage>;

  /**
   * Optional streaming chat interface.
   *
   * This is a forward-compatible contract only; the Grizzco pipeline does not
   * depend on streaming yet.
   */
  chatStream?(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<LLMStreamChunk>;

  /**
   * Optional capabilities for strategy orchestration.
   *
   * This keeps the Grizzco pipeline provider-agnostic while allowing deterministic
   * decisions (e.g., enabling tool calling) without relying on constructor names.
   */
  getCapabilities?(): {
    toolCalling?: boolean;
    responseFormatJsonObject?: boolean;
    streaming?: boolean;
  };

  /**
   * High-level goal-oriented methods (internally use chat)
   */
  createPlan(context: Context, instruction: string, lastError?: string): Promise<Plan>;
  createPatch(context: Context, plan: Plan, lastError?: string): Promise<string>;
}

export interface LoopOptions {
  instruction: string;
  verify: string;
  repoPath: string;
  llm: LLM;
  dryRun?: boolean;
  forceReset?: boolean;
  onEvent?: (event: LoopEvent) => void;
  verbose?: VerboseLevel;
  file?: string;
  contextFiles?: string[];
  selection?: string;
  expectedChanges?: string[];
  expectedFileContent?: { path: string; content: string }[];
  targetNodeName?: string;
  strategy?: CheckpointStrategy;
  applyBackOnDirty?: ApplyBackOnDirty;
  worktreePrepare?: string;
}

export interface ExecutionWorkspace {
  baseRepoPath: string;
  workPath: string;
  strategy: CheckpointStrategy;
}
