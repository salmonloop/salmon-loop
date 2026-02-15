/**
 * Token counting module.
 *
 * Provides accurate token counting with caching for performance optimization.
 *
 * @example
 * ```typescript
 * import { TokenCounter } from './token/index.js';
 *
 * const counter = new TokenCounter();
 * await counter.initialize();
 *
 * // Simple counting
 * const tokens = counter.count('Hello, world!');
 *
 * // Count for a model
 * const tokens = counter.countByModel('Hello', 'openai-gpt4');
 * ```
 */

export { TokenCounter } from './counter.js';
export { TokenCache } from './cache.js';
export { EncodingRegistry } from './encoding-registry.js';
export { TokenBudgetCalculator, DEFAULT_TOKEN_BUDGET_CONFIG } from './token-budget.js';

export type {
  EncodingType,
  ModelFamily,
  TokenCountResult,
  FileCacheEntry,
  CacheStats,
  TokenCounterConfig,
  IEncoding,
  SummaryModelConfig,
} from './types.js';

export type { BudgetMode, TokenBudgetConfig, ContextSectionTokens } from './token-budget.js';
