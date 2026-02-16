/**
 * Prompt Caching types and interfaces.
 *
 * Supports Claude, OpenAI, and Gemini Prompt Caching APIs.
 */

/**
 * Provider type for caching.
 */
export type CacheProvider = 'claude' | 'openai' | 'gemini';

/**
 * Cacheable content block.
 */
export interface CacheableBlock {
  /** Content type */
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  /** Content text or data */
  text?: string;
  /** For tool use */
  name?: string;
  input?: unknown;
  /** For tool result */
  tool_use_id?: string;
  content?: string;
  /** Cache control (provider-specific) */
  cache_control?: CacheControl;
}

/**
 * Cache control for Anthropic Claude.
 */
export interface CacheControl {
  /** Cache type: ephemeral (TTL-based) */
  type: 'ephemeral';
  /** Time-to-live in seconds (optional, provider default if not specified) */
  ttl?: number;
}

/**
 * OpenAI cache control via user parameter.
 */
export interface OpenAICacheHint {
  /** Cache namespace */
  namespace: string;
  /** Cache key components */
  components: string[];
}

/**
 * Gemini cache control.
 */
export interface GeminiCacheConfig {
  /** Cache name/identifier */
  cachedContent?: string;
  /** TTL in seconds */
  ttlSeconds?: number;
}

/**
 * Prompt caching statistics.
 */
export interface PromptCacheStats {
  /** Total tokens cached */
  cachedTokens: number;
  /** Total tokens in request */
  totalTokens: number;
  /** Cache hit rate */
  cacheHitRate: number;
  /** Provider */
  provider: CacheProvider;
}

/**
 * Prompt caching configuration.
 */
export interface PromptCachingConfig {
  /** Enable caching */
  enabled: boolean;
  /** Provider */
  provider: CacheProvider;
  /** Minimum tokens to cache (avoid overhead for small prompts) */
  minTokensToCache: number;
  /** Default TTL in seconds */
  defaultTTL?: number;
}

/**
 * Default prompt caching configuration.
 */
export const DEFAULT_PROMPT_CACHING_CONFIG: PromptCachingConfig = {
  enabled: true,
  provider: 'claude',
  minTokensToCache: 1024, // Only cache if > 1024 tokens
  defaultTTL: 3600, // 1 hour
};
