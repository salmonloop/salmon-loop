/**
 * TokenCounter - Facade for token counting operations.
 *
 * Provides a simple API for token counting while hiding the complexity
 * of encoding selection, caching, and file operations.
 */

import { readFile } from 'fs/promises';

import { TokenCache } from './cache.js';
import { EncodingRegistry } from './encoding-registry.js';
import type {
  EncodingType,
  ModelFamily,
  TokenCountResult,
  TokenCounterConfig,
  CacheStats,
} from './types.js';

/**
 * Default configuration for TokenCounter.
 */
const DEFAULT_CONFIG: Required<Omit<TokenCounterConfig, 'defaultEncoding'>> & {
  defaultEncoding: EncodingType;
} = {
  defaultEncoding: 'cl100k_base',
  cacheMaxSize: 1000,
  enableCache: true,
};

/**
 * TokenCounter provides unified token counting with caching.
 *
 * Features:
 * - Automatic encoding selection by model
 * - Two-level caching (memory + file)
 * - Batch operations
 * - Statistics monitoring
 *
 * @example
 * ```typescript
 * const counter = new TokenCounter();
 * await counter.initialize();
 *
 * // Simple counting
 * const tokens = counter.count('Hello, world!');
 *
 * // Count for a model
 * const tokens = counter.countByModel('Hello', 'openai-gpt4');
 *
 * // Count file with caching
 * const result = await counter.countFile('/path/to/file.ts');
 * ```
 */
export class TokenCounter {
  private registry: EncodingRegistry;
  private cache: TokenCache;
  private config: Required<TokenCounterConfig>;

  constructor(config: TokenCounterConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registry = new EncodingRegistry();
    this.cache = new TokenCache(this.config.cacheMaxSize);
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize encodings. Call once at application startup.
   */
  async initialize(): Promise<void> {
    await this.registry.initializeAll();
  }

  /**
   * Dispose resources. Call at application shutdown.
   */
  dispose(): void {
    this.registry.disposeAll();
    this.cache.clear();
  }

  /**
   * Check if initialized.
   */
  isInitialized(): boolean {
    return this.registry.isInitialized();
  }

  // ==================== Core Counting ====================

  /**
   * Count tokens in text.
   */
  count(text: string, encoding?: EncodingType): number {
    const enc = encoding ?? this.config.defaultEncoding;
    return this.registry.get(enc).count(text);
  }

  /**
   * Count tokens with cache metadata.
   */
  countWithMeta(text: string, encoding?: EncodingType): TokenCountResult {
    const enc = encoding ?? this.config.defaultEncoding;

    // Check cache first
    if (this.config.enableCache) {
      const cached = this.cache.getFromMemory(text);
      if (cached !== null) {
        return { tokens: cached, cached: true, encoding: enc };
      }
    }

    const tokens = this.registry.get(enc).count(text);

    // Update cache
    if (this.config.enableCache) {
      this.cache.setToMemory(text, tokens);
    }

    return { tokens, cached: false, encoding: enc };
  }

  /**
   * Count tokens for a specific model family.
   */
  countByModel(text: string, model: ModelFamily): number {
    return this.registry.getByModel(model).count(text);
  }

  /**
   * Count tokens with model and cache metadata.
   */
  countByModelWithMeta(text: string, model: ModelFamily): TokenCountResult {
    const encoding = this.registry.getEncodingTypeForModel(model);
    return this.countWithMeta(text, encoding);
  }

  // ==================== File Operations ====================

  /**
   * Count tokens in a file with caching.
   */
  async countFile(
    filePath: string,
    content?: string,
    encoding?: EncodingType,
  ): Promise<TokenCountResult> {
    const enc = encoding ?? this.config.defaultEncoding;

    // Check file cache
    if (this.config.enableCache) {
      const cached = await this.cache.getFromFile(filePath);
      if (cached !== null) {
        return { tokens: cached.tokens, cached: true, encoding: enc };
      }
    }

    // Read content if not provided
    const fileContent = content ?? (await this.readFileContent(filePath));
    const tokens = this.count(fileContent, enc);

    // Update cache
    if (this.config.enableCache) {
      await this.cache.setForFile(filePath, fileContent, tokens);
    }

    return { tokens, cached: false, encoding: enc };
  }

  // ==================== Batch Operations ====================

  /**
   * Count tokens for multiple texts.
   */
  countBatch(texts: string[], encoding?: EncodingType): number[] {
    return texts.map((text) => this.count(text, encoding));
  }

  /**
   * Count total tokens for multiple texts.
   */
  countTotal(texts: string[], encoding?: EncodingType): number {
    return this.countBatch(texts, encoding).reduce((sum, n) => sum + n, 0);
  }

  // ==================== Cache Management ====================

  /**
   * Invalidate cache for a specific file.
   */
  invalidateFile(path: string): void {
    this.cache.invalidateFile(path);
  }

  /**
   * Clear all caches.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  // ==================== Registry Access ====================

  /**
   * Get all registered encodings.
   */
  getRegisteredEncodings(): EncodingType[] {
    return this.registry.listEncodings();
  }

  /**
   * Get all registered models.
   */
  getRegisteredModels(): ModelFamily[] {
    return this.registry.listModels();
  }

  /**
   * Get encoding for a model.
   */
  getEncodingForModel(model: ModelFamily): EncodingType {
    return this.registry.getEncodingTypeForModel(model);
  }

  // ==================== Private ====================

  private async readFileContent(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }
}
