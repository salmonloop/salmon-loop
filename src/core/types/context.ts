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

export interface RelatedFileContext {
  path: string;
  content: string;
  kind: 'import' | 'failed' | 'dependency';
  mode: 'full' | 'outline';
  outline?: string;
}

export type ContextTargetReason =
  | 'primary'
  | 'explicit_path'
  | 'diff_included'
  | 'import_neighbor'
  | 'rg_hit'
  | 'fallback';

export type ContextTargetConfidence = 'high' | 'medium' | 'low';

export interface ContextTarget {
  path: string;
  reason: ContextTargetReason;
  confidence: ContextTargetConfidence;
  evidence?: string;
}

export interface AstSyntaxError {
  line: number;
  column: number;
  type: 'ERROR' | 'MISSING';
  text: string;
}

export interface ContextAnalysis {
  ast?: {
    languageId?: string;
    syntaxErrors?: AstSyntaxError[];
    parseError?: string;
    notes?: string[];
  };
}

export interface Context {
  repoPath: string;
  primaryFile?: string;
  primaryText?: string;
  relatedFiles?: RelatedFileContext[];
  rgSnippets: RipgrepResult[];
  /**
   * @deprecated Use stagedDiff and unstagedDiff instead
   */
  gitDiff?: string;
  stagedDiff?: string;
  unstagedDiff?: string;
  untrackedDiff?: string;
  untrackedFiles?: string[];
  definitionMap?: Record<string, CodeLocation>;
  symbols?: SymbolInfo[];
  targets?: ContextTarget[];
  analysis?: ContextAnalysis;
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
