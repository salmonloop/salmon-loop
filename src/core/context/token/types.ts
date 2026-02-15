/**
 * Token counting types and interfaces.
 *
 * Design Principles:
 * - Strategy pattern for encoding extensibility
 * - Model-agnostic configuration
 * - Cache-first for performance
 */

/**
 * Supported encoding types.
 * cl100k_base: GPT-4, GPT-3.5-turbo, text-embedding-ada-002, Claude
 * o200k_base: GPT-4o, GPT-4o-mini
 */
export type EncodingType = 'cl100k_base' | 'o200k_base';

/**
 * Model family for automatic encoding selection.
 * Extend this when adding new model providers.
 */
export type ModelFamily = 'openai-gpt4' | 'openai-gpt4o' | 'openai-gpt35' | 'anthropic-claude';

/**
 * Token count result with metadata.
 */
export interface TokenCountResult {
  /** Number of tokens */
  tokens: number;
  /** Whether result came from cache */
  cached: boolean;
  /** Encoding used for counting */
  encoding: EncodingType;
}

/**
 * Cache entry for file-level caching.
 */
export interface FileCacheEntry {
  /** Token count */
  tokens: number;
  /** File modification time for validation */
  mtime: number;
  /** Content hash (SHA256, first 16 chars) */
  contentHash: string;
}

/**
 * Cache statistics for monitoring.
 */
export interface CacheStats {
  /** Cache hits */
  hits: number;
  /** Cache misses */
  misses: number;
  /** Current cache size */
  size: number;
  /** Maximum cache size */
  maxSize: number;
  /** Hit rate (0-1) */
  hitRate: number;
}

/**
 * Token counter configuration.
 */
export interface TokenCounterConfig {
  /** Default encoding to use */
  defaultEncoding?: EncodingType;
  /** Maximum entries in LRU cache */
  cacheMaxSize?: number;
  /** Whether to enable caching */
  enableCache?: boolean;
}

/**
 * Encoding interface (Strategy pattern).
 * Implement this to add new encodings.
 */
export interface IEncoding {
  /** Encoding name */
  readonly name: EncodingType;
  /** Models that use this encoding */
  readonly models: ModelFamily[];

  /** Initialize the encoding (load WASM, etc.) */
  initialize(): Promise<void>;

  /** Encode text to tokens */
  encode(text: string): number[];

  /** Decode tokens to text */
  decode(tokens: number[]): string;

  /** Count tokens in text */
  count(text: string): number;

  /** Dispose resources */
  dispose(): void;
}

/**
 * Provider configuration for summary model selection.
 * Not hardcoded to any specific model.
 */
export interface SummaryModelConfig {
  /** Model identifier for summarization */
  model: string;
  /** Temperature for summarization */
  temperature?: number;
  /** Max tokens for summary output */
  maxTokens?: number;
}
