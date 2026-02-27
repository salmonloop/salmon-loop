/**
 * Optimized JSON context format type definitions
 * Uses shortest field names to reduce token consumption
 */

// 核心上下文数据结构
export interface JsonContextData {
  c: JsonContext; // context
}

export interface JsonContext {
  m: JsonManifest; // manifest
  pf?: [string, string]; // primaryFile [path, content]
  rf?: [string, string, string, string][]; // relatedFiles [path, reason, mode, content]
  s?: [string, number, string][]; // snippets [file, line, content]
  d?: JsonDiffs; // diffs
  a?: JsonAnalysis; // analysis
  pm?: JsonProjectMetadata; // projectMetadata
  gh?: JsonGitHistory; // gitHistory
  pt?: JsonProjectTopology; // projectTopology
}

export interface JsonProjectTopology {
  ms?: JsonModule[]; // modules
  fs?: string; // folderStructure
}

export interface JsonModule {
  n: string; // name
  p: string; // path
  d?: string; // description
  er?: 'c' | 'a' | 'cl' | 'u' | 'o'; // estimatedRole (core, adapter, cli, util, other)
}

export interface JsonGitHistory {
  rc?: string; // recentCommits
}

export interface JsonProjectMetadata {
  pj?: any; // packageJson
  rh?: string; // readmeHeader
  cf?: string[]; // configFiles
  ai?: string; // aiInstructions
}

// 目标清单（精简字段名）
export interface JsonManifest {
  t?: JsonTarget[]; // targets
  rm?: JsonRepoMap; // repoMap
  sm?: JsonSymbolMap; // symbolMap
}

export interface JsonTarget {
  p: string; // path
  r: string; // reason
  c: 'h' | 'm' | 'l'; // confidence (high, medium, low)
  e?: JsonEvidence; // evidence
}

export interface JsonEvidence {
  t: string; // type
  n?: string; // name/symbolName
  d?: {
    // details
    [key: string]: any;
  };
}

// 仓库映射（依赖关系图）
export interface JsonRepoMap {
  tr: 's' | 'd'; // trigger (shallow, deep)
  md: number; // maxDepth
  n: JsonRepoNode[]; // nodes
  e: JsonRepoEdge[]; // edges
}

export interface JsonRepoNode {
  p: string; // path
  d: number; // depth
  s: 'p' | 'i'; // source (primary, import)
}

export interface JsonRepoEdge {
  f: string; // from
  t: string; // to
  ty: string; // type
}

// 符号映射（AST 关系）
export interface JsonSymbolMap {
  n: JsonSymbolNode[]; // nodes
  e: JsonSymbolEdge[]; // edges
}

export interface JsonSymbolNode {
  i: string; // id
  n: string; // name
  k: 'd' | 'r'; // kind (definition, reference)
  p?: string; // path
  l: number; // line
  co: number; // column
}

export interface JsonSymbolEdge {
  f: string; // from
  t: string; // to
  ty: string; // type
  c: 'h' | 'm' | 'l'; // confidence
}

// 主要文件
export interface JsonPrimaryFile {
  p: string; // path
  c: string; // content
}

// 相关文件
export interface JsonRelatedFile {
  p: string; // path
  r: string; // reason
  m: 'f' | 'o'; // mode (full, outline)
  c: string; // content
}

// 代码片段
export interface JsonSnippet {
  f: string; // file
  l: number; // line
  c: string; // content
}

// Git 差异
export interface JsonDiffs {
  s?: string; // staged
  u?: string; // unstaged
  g?: string; // git
  ut?: string; // untracked
}

// AST 分析
export interface JsonAnalysis {
  ast?: JsonAST;
}

export interface JsonAST {
  l?: string; // languageId
  pe?: string; // parseError
  se?: JsonSyntaxError[]; // syntaxErrors
  cf?: JsonControlFlow; // controlFlow
  ep?: JsonExceptionPaths; // exceptionPaths
  n?: string[]; // notes
}

export interface JsonSyntaxError {
  l: number; // line
  co: number; // column
  t: 'E' | 'M'; // type (ERROR, MISSING)
  tx: string; // text
}

export interface JsonControlFlow {
  b: number; // branches
  lp: number; // loops
  ab: number; // asyncBoundaries
  h?: string[]; // hotspots
}

export interface JsonExceptionPaths {
  tc: number; // tryCatch
  th: number; // throws
  pc: number; // promiseCatch
  h?: string[]; // hotspots
}

// 格式检测
export type FormatPreference = 'json' | 'xml' | 'auto';

export interface FormatRequest {
  headers?: {
    accept?: string;
    'content-type'?: string;
  };
}

// 性能监控
export interface PerformanceMetrics {
  conversionTime: number;
  originalSize: number;
  compressedSize: number;
  tokenReduction: number;
  compressionRatio: number;
}
