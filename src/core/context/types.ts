import type { CheckpointManager } from '../strata/checkpoint/manager.js';
import type { Context, RipgrepResult, CodeLocation, SymbolInfo } from '../types.js';

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
}

export interface ContextResult {
  context: Context;
  prompt: string;
  meta: ContextBuildMeta;
}
