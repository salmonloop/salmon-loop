import type { Context } from '../../types/index.js';
import type { AstResult } from '../gatherers/ast-gatherer.js';
import type { GitDiffResult } from '../gatherers/git-diff-gatherer.js';
import type { ContextRequest, DiffScope } from '../types.js';

export interface ContextPipelineInitCtx {
  req: ContextRequest;
  diffScope: DiffScope;
}

export interface ContextPrimaryCtx extends ContextPipelineInitCtx {
  primaryText: string | undefined;
}

export interface ContextGatherCtx extends ContextPrimaryCtx {
  rgSnippets: Context['rgSnippets'];
  diffRes: GitDiffResult;
  astRes: AstResult;
}

export interface ContextTargetsCtx extends ContextPipelineInitCtx {
  primaryText: string | undefined;
  rgSnippets: Context['rgSnippets'];
  targets: Context['targets'];
  includedFiles: string[];
  stagedDiff: string | undefined;
  unstagedDiff: string | undefined;
  gitDiff: string | undefined;
  relatedFiles: Context['relatedFiles'];
  symbols: Context['symbols'];
  definitionMap: Context['definitionMap'];
  analysis: Context['analysis'];
}
