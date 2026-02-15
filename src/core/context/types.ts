import type { CheckpointManager } from '../strata/checkpoint/manager.js';
import type { Context, RipgrepResult, CodeLocation, SymbolInfo } from '../types/index.js';

export type DiffScope = 'primary' | 'ast_related';

export interface ContextRequest {
  instruction: string;
  repoPath: string;
  primaryFile?: string;
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
