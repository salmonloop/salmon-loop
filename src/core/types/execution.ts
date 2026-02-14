export type VerboseLevel = 'basic' | 'extended';
export type ApplyBackOnDirty = 'abort' | '3way';
export type FlowMode = 'patch' | 'review' | 'debug';

export interface FileSystem {
  readFile(path: string, encoding?: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

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
  'EXPLORE',
  'PLAN',
  'PATCH',
  'VALIDATE',
  'AST_VALIDATE',
  'APPLY',
  'VERIFY',
  'ROLLBACK',
  'SHRINK',
  'APPLY_BACK',
] as const;

/**
 * Phase (Object):
 * - Used for value access in code logic (e.g., `if (phase === Phase.PLAN)`).
 * - Eliminates "magic strings" and allows easy refactoring/renaming.
 */
export const Phase = {
  // SLASH is an out-of-band interactive phase used for adapter-level slash routing and skill expansion.
  // It is intentionally excluded from EXECUTION_PHASES to avoid impacting the main SalmonLoop flow.
  SLASH: 'SLASH',
  PREFLIGHT: 'PREFLIGHT',
  CONTEXT: 'CONTEXT',
  EXPLORE: 'EXPLORE',
  PLAN: 'PLAN',
  PATCH: 'PATCH',
  VALIDATE: 'VALIDATE',
  AST_VALIDATE: 'AST_VALIDATE',
  APPLY: 'APPLY',
  VERIFY: 'VERIFY',
  ROLLBACK: 'ROLLBACK',
  SHRINK: 'SHRINK',
  APPLY_BACK: 'APPLY_BACK',
} as const;

/**
 * ExecutionPhase (Type):
 * - Derived automatically from the array.
 * - Used for TypeScript type checking and function signatures.
 */
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number] | typeof Phase.SLASH;

export const ALL_VISIBLE_STEPS = [
  ...EXECUTION_PHASES,
  'REVIEW',
  'REPORT',
  'ANALYZE_ISSUES',
] as const;

export type ExecutionStep = (typeof ALL_VISIBLE_STEPS)[number];

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
