import type { Context } from '../../types/index.js';
import type {
  AstSyntaxError,
  CodeLocation,
  RelatedFileContext,
  SymbolInfo,
} from '../../types/index.js';
import type { ContextRequest, DiffScope } from '../types.js';

export interface ContextDiffBundle {
  includedFiles: string[];
  stagedDiff?: string;
  unstagedDiff?: string;
  gitDiff?: string;
}

export interface ContextAstBundle {
  symbols: SymbolInfo[];
  definitionMap: Record<string, CodeLocation>;
  relatedFiles: RelatedFileContext[];
  languageId?: string;
  syntaxErrors?: AstSyntaxError[];
  parseError?: string;
}

export interface ContextPipelineInitCtx {
  req: ContextRequest;
  diffScope: DiffScope;
}

export interface ContextPrimaryCtx extends ContextPipelineInitCtx {
  primaryText: string | undefined;
}

export interface ContextGatherCtx extends ContextPrimaryCtx {
  rgSnippets: Context['rgSnippets'];
  diff: ContextDiffBundle;
  ast: ContextAstBundle;
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
