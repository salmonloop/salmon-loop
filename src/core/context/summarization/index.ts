/**
 * Conversation summarization module.
 *
 * Provides incremental summarization with async execution for
 * efficient long-context management.
 *
 * @example
 * ```typescript
 * import { ConversationSummarizer } from './summarization/index.js';
 *
 * const summarizer = new ConversationSummarizer(llmClient, tokenCounter, {
 *   summaryModel: { model: 'claude-3-5-haiku' }
 * });
 *
 * // Check and trigger summarization
 * if (summarizer.shouldTrigger(messages)) {
 *   await summarizer.triggerSummarization(messages);
 * }
 *
 * // Get effective context
 * const context = summarizer.getEffectiveContext(messages);
 * ```
 */

export { ConversationSummarizer } from './summarizer.js';
export { buildIncrementalSummaryPrompt, truncateSummary } from './prompts.js';

export type {
  SummarizationConfig,
  SummarizationResult,
  SummarizableMessage,
  SummaryState,
  SummarizationLLMClient,
  SummarizationTokenCounter,
} from './types.js';

export { DEFAULT_SUMMARIZATION_CONFIG } from './types.js';
