/**
 * 上下文格式化器导出
 */

export { ContextFormatConverter } from './json-converter.js';
export type {
  JsonContextData,
  JsonContext,
  JsonManifest,
  JsonTarget,
  JsonEvidence,
  JsonRepoMap,
  JsonRepoNode,
  JsonRepoEdge,
  JsonSymbolMap,
  JsonSymbolNode,
  JsonSymbolEdge,
  JsonPrimaryFile,
  JsonRelatedFile,
  JsonSnippet,
  JsonDiffs,
  JsonAnalysis,
  JsonAST,
  JsonSyntaxError,
  JsonControlFlow,
  JsonExceptionPaths,
  FormatPreference,
  FormatRequest,
  PerformanceMetrics,
} from './types.js';

// 保持向后兼容性 - 重新导出 XML 格式化器
export { formatContextForXmlPrompt } from './xml-context.js';
