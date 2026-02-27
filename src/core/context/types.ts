import type { CheckpointManager } from '../strata/checkpoint/manager.js';
import type {
  CodeLocation,
  Context,
  RipgrepResult,
  SymbolInfo,
  WorkspaceMode,
} from '../types/index.js';

export type DiffScope = 'primary' | 'ast_related';

export interface ContextRequest {
  instruction: string;
  repoPath: string;
  primaryFile?: string;
  workspaceMode?: WorkspaceMode;
  selection?: string;
  snapshotHash?: string;
  checkpointManager?: CheckpointManager;
  diffScope?: DiffScope;
  budgetChars?: number;
  signal?: AbortSignal;
}

export interface ContextBag {
  primaryText?: string;
  rgSnippets: RipgrepResult[];
  stagedDiff?: string;
  unstagedDiff?: string;
  gitDiff?: string;
  symbols?: SymbolInfo[];
  definitionMap?: Record<string, CodeLocation>;
}

export interface ContextBuildMeta {
  usedChars: number;
  truncated: boolean;
  diffScope: DiffScope;
  includedFiles: string[];
  requestedBudgetChars?: number;
  preBudgetSectionChars?: ContextSectionChars;
  sectionChars: ContextSectionChars;
  droppedSections?: DroppedContextSections;
  budgetAllocation?: ContextBudgetAllocation;
  contextHash?: string;
  environment?: {
    workspaceMode: WorkspaceMode;
  };
}

export interface ContextSectionChars {
  primary: number;
  relatedFiles: number;
  rgSnippets: number;
  diffs: number;
  total: number;
}

export interface DroppedContextSections {
  stagedDiff: boolean;
  unstagedDiff: boolean;
  gitDiff: boolean;
  untrackedDiff: boolean;
}

export interface ContextResult {
  context: Context;
  prompt: string;
  meta: ContextBuildMeta;
}

export interface ContextBudgetAllocation {
  ratio: {
    primary: number;
    related: number;
    secondary: number;
  };
  budgetChars: {
    primary: number;
    related: number;
    secondary: number;
  };
  usedChars: {
    primary: number;
    related: number;
    secondary: number;
  };
}
