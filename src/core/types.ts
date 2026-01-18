export interface Plan {
  reasoning: string;
  steps: PlanStep[];
  filesToChange: string[];
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
  finalPatch?: string;
}

export interface StepLog {
  step: 'plan' | 'patch' | 'apply' | 'verify';
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