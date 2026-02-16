/**
 * Context caching module.
 *
 * Provides caching infrastructure for context management:
 * - File-level token caching (via TokenCache)
 * - Prompt caching for Claude/OpenAI/Gemini
 * - Incremental context updates
 *
 * @example
 * ```typescript
 * import { PromptCachingManager, getIncrementalUpdater } from './cache/index.js';
 *
 * // Prompt caching
 * const caching = new PromptCachingManager();
 * const { system, messages } = caching.prepareClaudeMessages(sysPrompt, context);
 *
 * // Incremental updates
 * const updater = getIncrementalUpdater();
 * const diff = updater.computeDiff(newContext);
 * ```
 */

export {
  PromptCachingManager,
  getPromptCachingManager,
  resetPromptCachingManager,
} from './prompt-caching.js';

export {
  IncrementalUpdater,
  getIncrementalUpdater,
  resetIncrementalUpdater,
} from './incremental-updater.js';

export type {
  CacheProvider,
  CacheableBlock,
  CacheControl,
  OpenAICacheHint,
  GeminiCacheConfig,
  PromptCacheStats,
  PromptCachingConfig,
} from './types.js';

export { DEFAULT_PROMPT_CACHING_CONFIG } from './types.js';

export type { ContextDiff } from './incremental-updater.js';
