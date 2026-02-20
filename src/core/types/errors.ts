import type { ExecutionPhase } from './execution.js';

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

export class PatchNotApplicableError extends SalmonError {
  constructor(message: string) {
    super(message, 'PATCH_NOT_APPLICABLE');
  }
}

export type ErrorDomain =
  | 'applyBack'
  | 'git'
  | 'llm'
  | 'tool'
  | 'runtime'
  | 'verification'
  | 'unknown';

export interface DebugArtifactRef {
  path: string;
  sha256: string;
  chars: number;
}

export interface ErrorEnvelope {
  domain: ErrorDomain;
  code: string;
  phase?: ExecutionPhase;
  /**
   * Localized, user-facing message. Must not contain raw technical dumps.
   */
  safeMessage: string;
  /**
   * Safe metadata for diagnostics and auditing. Must be JSON-serializable and non-sensitive.
   */
  safeMeta?: Record<string, unknown>;
  /**
   * Optional local-only debug artifact reference for deeper investigation.
   */
  debugArtifact?: DebugArtifactRef;
}
