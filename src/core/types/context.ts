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
  | 'symbol_definition'
  | 'diff_included'
  | 'failed_file'
  | 'import_neighbor'
  | 'rg_hit'
  | 'fallback';

export type ContextTargetConfidence = 'high' | 'medium' | 'low';

export interface ContextTarget {
  path: string;
  reason: ContextTargetReason;
  confidence: ContextTargetConfidence;
  evidence?: string | TargetEvidence; // Structured evidence for future extensibility
}

/**
 * Structured evidence for target selection.
 * Currently optional, will be gradually migrated from string evidence.
 */
export interface TargetEvidence {
  type: 'symbol' | 'path' | 'diff' | 'import' | 'ripgrep' | 'fallback';
  details?: {
    symbolName?: string;
    location?: { line: number; column: number };
    matchType?: 'definition' | 'reference' | 'call';
    source?: 'definitionMap' | 'symbolMap';
    distance?: number; // For symbol diffusion
    weight?: number; // For symbol diffusion
  };
  raw?: string; // Legacy string evidence for backward compatibility
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
    controlFlow?: {
      branchCount: number;
      loopCount: number;
      asyncBoundaryCount: number;
      hotspots?: string[];
    };
    exceptionPaths?: {
      tryCatchCount: number;
      throwCount: number;
      promiseCatchCount: number;
      hotspots?: string[];
    };
    notes?: string[];
  };
}

export interface SymbolMapNode {
  id: string;
  name: string;
  kind: 'definition' | 'reference';
  path?: string;
  location: CodeLocation;
}

export interface SymbolMapEdge {
  from: string;
  to: string;
  type: 'reference' | 'call';
  confidence: 'high' | 'medium' | 'low';
}

export interface SymbolMap {
  nodes: SymbolMapNode[];
  edges: SymbolMapEdge[];
}

export interface RepoMapNode {
  path: string;
  depth: number;
  source: 'primary' | 'import';
}

export interface RepoMapEdge {
  from: string;
  to: string;
  type: 'import';
}

export interface RepoMap {
  nodes: RepoMapNode[];
  edges: RepoMapEdge[];
  maxDepth: number;
  trigger: 'shallow' | 'deep';
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
  repoMap?: RepoMap;
  symbolMap?: SymbolMap;
  projectMetadata?: {
    packageJson?: any;
    readmeHeader?: string;
    configFiles?: string[];
    aiInstructions?: string;
  };
  gitHistory?: {
    recentCommits?: string;
  };
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
