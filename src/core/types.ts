export type VerboseLevel = 'basic' | 'extended';

export enum ExecutionPhase {
  PREFLIGHT = 'preflight',
  CONTEXT = 'context',
  PLAN = 'plan',
  PATCH = 'patch',
  VALIDATE = 'validate',
  APPLY = 'apply',
  VERIFY = 'verify',
  ROLLBACK = 'rollback',
  SHRINK = 'shrink',
}

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
  step: ExecutionPhase | 'error';
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
  gitDiff?: string;
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
  selection?: string;
  dryRun?: boolean;
  verbose?: VerboseLevel;
  strategy?: CheckpointStrategy;
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
    super(message, 'GIT_ERROR');
  }
}

export class DiffValidationError extends SalmonError {
  constructor(message: string) {
    super(message, 'DIFF_VALIDATION_FAILED');
  }
}

export type CheckpointStrategy = 'direct' | 'worktree'

export interface ExecutionWorkspace {
  baseRepoPath: string
  workPath: string
  strategy: CheckpointStrategy
}

