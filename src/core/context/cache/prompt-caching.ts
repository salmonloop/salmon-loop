/**
 * Prompt Caching support for different providers.
 *
 * Provides unified interface for Claude, OpenAI, and Gemini caching.
 */

import type {
  CacheProvider,
  CacheableBlock,
  CacheControl,
  OpenAICacheHint,
  GeminiCacheConfig,
  PromptCacheStats,
  PromptCachingConfig,
} from './types.js';
import { DEFAULT_PROMPT_CACHING_CONFIG } from './types.js';

/**
 * Prompt Caching manager.
 *
 * Abstracts provider-specific caching mechanisms:
 * - **Claude**: Uses `cache_control` parameter on content blocks
 * - **OpenAI**: Uses `user` parameter for cache hints
 * - **Gemini**: Uses `cachedContent` configuration
 */
export class PromptCachingManager {
  private stats: PromptCacheStats;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(private config: PromptCachingConfig = DEFAULT_PROMPT_CACHING_CONFIG) {
    this.stats = {
      cachedTokens: 0,
      totalTokens: 0,
      cacheHitRate: 0,
      provider: config.provider,
    };
  }

  /**
   * Set provider.
   */
  setProvider(provider: CacheProvider): void {
    this.config.provider = provider;
    this.stats.provider = provider;
  }

  /**
   * Get current provider.
   */
  getProvider(): CacheProvider {
    return this.config.provider;
  }

  /**
   * Mark content block as cacheable (Claude).
   *
   * @param content - Content text
   * @param ttl - Optional TTL in seconds
   * @returns Cacheable block for Claude API
   */
  markCacheableForClaude(content: string, ttl?: number): CacheableBlock {
    const cacheControl: CacheControl = {
      type: 'ephemeral',
      ...(ttl && { ttl }),
    };

    return {
      type: 'text',
      text: content,
      cache_control: cacheControl,
    };
  }

  /**
   * Generate cache hint for OpenAI (via user parameter).
   *
   * @param namespace - Cache namespace
   * @param components - Cache key components
   * @returns Cache hint string for user parameter
   */
  generateOpenAICacheHint(namespace: string, components: string[]): string {
    const hint: OpenAICacheHint = {
      namespace,
      components,
    };
    return `cache:${JSON.stringify(hint)}`;
  }

  /**
   * Generate Gemini cache configuration.
   *
   * @param cacheName - Cache identifier
   * @param ttlSeconds - TTL in seconds
   * @returns Gemini cache configuration
   */
  generateGeminiCacheConfig(cacheName: string, ttlSeconds?: number): GeminiCacheConfig {
    return {
      cachedContent: cacheName,
      ...(ttlSeconds && { ttlSeconds }),
    };
  }

  /**
   * Check if caching should be enabled for given token count.
   */
  shouldCache(tokenCount: number): boolean {
    if (!this.config.enabled) return false;
    return tokenCount >= this.config.minTokensToCache;
  }

  /**
   * Record cache hit.
   */
  recordHit(cachedTokens: number): void {
    this.cacheHits++;
    this.stats.cachedTokens += cachedTokens;
    this.updateHitRate();
  }

  /**
   * Record cache miss.
   */
  recordMiss(): void {
    this.cacheMisses++;
    this.updateHitRate();
  }

  /**
   * Get cache statistics.
   */
  getStats(): PromptCacheStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.stats = {
      cachedTokens: 0,
      totalTokens: 0,
      cacheHitRate: 0,
      provider: this.config.provider,
    };
  }

  /**
   * Prepare messages with caching for Claude.
   *
   * @param systemPrompt - System prompt
   * @param context - Context content
   * @returns Messages with cache control
   */
  prepareClaudeMessages(
    systemPrompt: string,
    context: string,
  ): { system: CacheableBlock[]; messages: CacheableBlock[] } {
    const blocks: CacheableBlock[] = [];

    // System prompt is usually static, mark as cacheable
    if (systemPrompt && this.shouldCache(this.estimateTokens(systemPrompt))) {
      blocks.push(this.markCacheableForClaude(systemPrompt, this.config.defaultTTL));
    } else if (systemPrompt) {
      blocks.push({ type: 'text', text: systemPrompt });
    }

    // Context content can be cached
    const contextBlocks: CacheableBlock[] = [];
    if (context && this.shouldCache(this.estimateTokens(context))) {
      contextBlocks.push(this.markCacheableForClaude(context, this.config.defaultTTL));
    } else if (context) {
      contextBlocks.push({ type: 'text', text: context });
    }

    return { system: blocks, messages: contextBlocks };
  }

  /**
   * Prepare request with caching for OpenAI.
   *
   * @param namespace - Cache namespace
   * @param contextHash - Context hash for cache key
   * @returns User parameter for cache hint
   */
  prepareOpenAIRequest(namespace: string, contextHash: string): string {
    return this.generateOpenAICacheHint(namespace, [contextHash]);
  }

  /**
   * Prepare request with caching for Gemini.
   *
   * @param cacheName - Cache resource name
   * @returns Gemini cache configuration
   */
  prepareGeminiRequest(cacheName: string): GeminiCacheConfig {
    return this.generateGeminiCacheConfig(cacheName, this.config.defaultTTL);
  }

  /**
   * Update hit rate.
   */
  private updateHitRate(): void {
    const total = this.cacheHits + this.cacheMisses;
    this.stats.cacheHitRate = total === 0 ? 0 : this.cacheHits / total;
  }

  /**
   * Estimate token count (rough estimate).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Global prompt caching manager instance.
 */
let globalInstance: PromptCachingManager | null = null;

/**
 * Get global prompt caching manager.
 */
export function getPromptCachingManager(): PromptCachingManager {
  if (!globalInstance) {
    globalInstance = new PromptCachingManager();
  }
  return globalInstance;
}

/**
 * Reset global instance (for testing).
 */
export function resetPromptCachingManager(): void {
  globalInstance = null;
}
