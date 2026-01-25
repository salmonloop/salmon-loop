import { ExecutionPhase } from '../types';

/**
 * Backend failure codes for classification and fallback decisions.
 */
export type BackendFailCode =
  | 'UNAVAILABLE' // Command not found/permission denied/platform unsupported
  | 'BAD_INPUT' // Invalid input (usually shouldn't fallback)
  | 'TIMEOUT' // Execution timed out
  | 'OUTPUT_TOO_LARGE' // Result exceeds size limits
  | 'RUNTIME_ERROR' // Unexpected errors during execution or parsing
  | 'NONZERO_EXIT'; // Process exited with non-zero code but might be recoverable

export interface BackendOk<O> {
  ok: true;
  output: O;
  meta?: Record<string, any>;
}

export interface BackendFail {
  ok: false;
  code: BackendFailCode;
  message: string;
  retryable: boolean;
  meta?: Record<string, any>;
}

export type BackendResult<O> = BackendOk<O> | BackendFail;

/**
 * Controlled execution options for the runner.
 */
export interface ExecOpts {
  cwd?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Context provided to every Backend and Executor.
 * Decouples backends from global state and provides controlled execution.
 */
export interface CapabilityCtx {
  repoRoot: string;
  worktreeRoot?: string;
  phase: ExecutionPhase;
  attemptId: number;
  dryRun: boolean;
  platform: string;

  // Controlled runner to prevent backends from bypassing policies
  runner: {
    execFile: (file: string, args: string[], opts?: ExecOpts) => Promise<ExecResult>;
  };

  limits: {
    timeoutMs: number;
    maxOutputBytes: number;
  };

  // Audit hook for recording backend-level events
  audit: {
    event: (e: any) => void;
  };
}

/**
 * Interface for a specific tool implementation (e.g., rg, powershell).
 */
export interface Backend<I, O> {
  id: string;

  /**
   * Checks if this backend is compatible with the current environment.
   */
  isCompatible(ctx: CapabilityCtx): Promise<boolean>;

  /**
   * Executes the capability using this specific implementation.
   */
  run(input: I, ctx: CapabilityCtx): Promise<BackendResult<O>>;

  /**
   * Optional hook to normalize input specifically for this backend.
   */
  normalizeInput?(input: I): I;
}
