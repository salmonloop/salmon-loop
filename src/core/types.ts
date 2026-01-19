export enum ExecutionPhase {
  PLAN = 'plan',
  PATCH = 'patch',
  VALIDATE = 'validate',
  APPLY = 'apply',
  VERIFY = 'verify',
  ROLLBACK = 'rollback',
  SHRINK = 'shrink'
}

export enum ErrorType {
  COMPILATION = 'compilation',
  LINT = 'lint',
  TEST = 'test',
  LOGIC = 'logic',
  UNKNOWN = 'unknown'
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
  changeType: 'modify' | 'add' | 'delete';
}

export interface LoopResult {
  success: boolean;
  reason: string;
  attempts: number;
  logs: StepLog[];
  history?: LoopIteration[];
  finalPatch?: string;
  failurePhase?: ExecutionPhase;
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
  error?: string;
  output?: string;
  timestamp: Date;
}

export interface Context {
  repoPath: string;
  primaryText?: string;
  rgSnippets: RipgrepResult[];
  gitDiff?: string;
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
  repo: string;
  file?: string;
  selection?: string;
  dryRun?: boolean;
  verbose?: boolean;
}