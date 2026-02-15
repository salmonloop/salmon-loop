/**
 * ConversationSummarizer - Incremental + Async summarization.
 *
 * Features:
 * - Incremental summarization (progressive)
 * - Async execution (non-blocking)
 * - Pre-trigger at 90% threshold
 * - Graceful failure handling
 *
 * Based on best practices from LangChain, OpenAI Realtime API, and Voice AI systems.
 */

import { logger } from '../../observability/logger.js';

import { buildIncrementalSummaryPrompt, truncateSummary } from './prompts.js';
import type {
  SummarizationConfig,
  SummarizationResult,
  SummarizableMessage,
  SummaryState,
  SummarizationLLMClient,
  SummarizationTokenCounter,
} from './types.js';
import { DEFAULT_SUMMARIZATION_CONFIG } from './types.js';

/**
 * ConversationSummarizer manages incremental summarization of chat history.
 *
 * @example
 * ```typescript
 * const summarizer = new ConversationSummarizer(llmClient, tokenCounter, {
 *   summaryModel: { model: 'claude-3-5-haiku', temperature: 0 }
 * });
 *
 * // On each new message
 * if (summarizer.shouldTrigger(messages)) {
 *   await summarizer.triggerSummarization(messages);
 * }
 *
 * // Get context for LLM
 * const context = summarizer.getEffectiveContext(messages);
 * ```
 */
export class ConversationSummarizer {
  private state: SummaryState;
  private summaryInProgress = false;
  private initialized = false;

  constructor(
    private readonly llm: SummarizationLLMClient,
    private readonly tokenCounter: SummarizationTokenCounter,
    private readonly config: SummarizationConfig = DEFAULT_SUMMARIZATION_CONFIG,
  ) {
    this.state = {
      summary: '',
      summaryTokens: 0,
      summarizedMessageIds: [],
      lastSummarizedAt: 0,
    };
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize the summarizer.
   */
  async initialize(): Promise<void> {
    this.initialized = true;
    logger.debug('[Summarizer] Initialized');
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.reset();
    this.initialized = false;
  }

  // ==================== State Management ====================

  /**
   * Get current state for persistence.
   */
  getState(): SummaryState {
    return {
      summary: this.state.summary,
      summaryTokens: this.state.summaryTokens,
      summarizedMessageIds: [...this.state.summarizedMessageIds],
      lastSummarizedAt: this.state.lastSummarizedAt,
    };
  }

  /**
   * Restore state from persistence.
   */
  restoreState(state: SummaryState): void {
    this.state = {
      summary: state.summary,
      summaryTokens: state.summaryTokens,
      summarizedMessageIds: [...state.summarizedMessageIds],
      lastSummarizedAt: state.lastSummarizedAt,
    };
    logger.debug(
      `[Summarizer] Restored state with ${state.summarizedMessageIds.length} summarized messages`,
    );
  }

  /**
   * Reset summarizer state.
   */
  reset(): void {
    this.state = {
      summary: '',
      summaryTokens: 0,
      summarizedMessageIds: [],
      lastSummarizedAt: 0,
    };
    this.summaryInProgress = false;
  }

  // ==================== Context Generation ====================

  /**
   * Get effective context for LLM call.
   * Returns: summary message + recent original messages.
   */
  getEffectiveContext(messages: SummarizableMessage[]): SummarizableMessage[] {
    const result: SummarizableMessage[] = [];

    // 1. Add summary if exists
    if (this.state.summary) {
      result.push({
        id: 'summary',
        role: 'system',
        content: `[Previous conversation summary]\n${this.state.summary}`,
        timestamp: this.state.lastSummarizedAt,
      });
    }

    // 2. Add recent messages not yet summarized
    const summarizedSet = new Set(this.state.summarizedMessageIds);
    const recentMessages = messages
      .filter((m) => !summarizedSet.has(m.id))
      .slice(-this.config.keepRecentMessages);

    result.push(...recentMessages);

    return result;
  }

  // ==================== Token Calculation ====================

  /**
   * Calculate total tokens for messages.
   */
  calculateTokens(messages: SummarizableMessage[]): number {
    let total = this.state.summaryTokens;

    const summarizedSet = new Set(this.state.summarizedMessageIds);
    for (const msg of messages) {
      if (!summarizedSet.has(msg.id)) {
        total += this.tokenCounter.count(this.formatMessage(msg));
      }
    }

    return total;
  }

  // ==================== Trigger Logic ====================

  /**
   * Check if summarization should be triggered.
   */
  shouldTrigger(messages: SummarizableMessage[]): boolean {
    if (this.summaryInProgress) return false;

    const tokens = this.calculateTokens(messages);
    const threshold = this.config.triggerTokens * this.config.preTriggerRatio;

    return tokens >= threshold && messages.length > this.config.keepRecentMessages;
  }

  /**
   * Get current token usage ratio (0-1).
   */
  getUsageRatio(messages: SummarizableMessage[]): number {
    const tokens = this.calculateTokens(messages);
    return tokens / this.config.triggerTokens;
  }

  // ==================== Summarization Execution ====================

  /**
   * Trigger summarization.
   * If async mode, returns null immediately and runs in background.
   */
  async triggerSummarization(messages: SummarizableMessage[]): Promise<SummarizationResult | null> {
    if (this.summaryInProgress) {
      logger.debug('[Summarizer] Summary already in progress, skipping');
      return null;
    }

    if (!this.shouldTrigger(messages)) {
      return null;
    }

    if (this.config.async) {
      // Fire and forget
      this.runSummarization(messages).catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[Summarizer] Async summarization failed: ${errMsg}`);
      });
      return null;
    }

    return this.runSummarization(messages);
  }

  /**
   * Force summarization now (for session end or explicit request).
   */
  async forceSummarize(messages: SummarizableMessage[]): Promise<SummarizationResult | null> {
    if (messages.length <= this.config.keepRecentMessages) {
      return null;
    }
    return this.runSummarization(messages);
  }

  /**
   * Run incremental summarization.
   */
  private async runSummarization(messages: SummarizableMessage[]): Promise<SummarizationResult> {
    this.summaryInProgress = true;

    try {
      // 1. Get messages to summarize (exclude recent N)
      const summarizedSet = new Set(this.state.summarizedMessageIds);
      const toSummarize = messages
        .filter((m) => !summarizedSet.has(m.id))
        .slice(0, -this.config.keepRecentMessages);

      if (toSummarize.length === 0) {
        return {
          summary: this.state.summary,
          messagesSummarized: 0,
          tokensBefore: 0,
          tokensAfter: this.state.summaryTokens,
          tokenReduction: 0,
          async: this.config.async,
        };
      }

      // 2. Batch if too many
      const batch = toSummarize.slice(0, this.config.maxBatchSize);
      const beforeTokens = batch.reduce(
        (sum, m) => sum + this.tokenCounter.count(this.formatMessage(m)),
        0,
      );

      // 3. Build prompt and call LLM
      const prompt = buildIncrementalSummaryPrompt({
        currentSummary: this.state.summary,
        newMessages: batch,
      });

      const response = await this.llm.chat({
        model: this.config.summaryModel.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.summaryModel.temperature ?? 0,
        maxTokens: this.config.maxSummaryTokens,
      });

      let newSummary = response.content;
      const afterTokens = this.tokenCounter.count(newSummary);

      // 4. Truncate if needed
      if (afterTokens > this.config.maxSummaryTokens) {
        newSummary = truncateSummary(newSummary, this.config.maxSummaryTokens, (text) =>
          this.tokenCounter.count(text),
        );
      }

      // 5. Update state
      this.state.summary = newSummary;
      this.state.summaryTokens = this.tokenCounter.count(newSummary);
      for (const msg of batch) {
        this.state.summarizedMessageIds.push(msg.id);
      }
      this.state.lastSummarizedAt = Date.now();

      logger.info(
        `[Summarizer] Summarized ${batch.length} messages, ` +
          `reduced ${beforeTokens} → ${this.state.summaryTokens} tokens`,
      );

      return {
        summary: newSummary,
        messagesSummarized: batch.length,
        tokensBefore: beforeTokens,
        tokensAfter: this.state.summaryTokens,
        tokenReduction: beforeTokens - this.state.summaryTokens,
        async: this.config.async,
      };
    } catch (error) {
      logger.error('[Summarizer] Summarization failed', error);
      throw error;
    } finally {
      this.summaryInProgress = false;
    }
  }

  // ==================== Private Helpers ====================

  private formatMessage(msg: SummarizableMessage): string {
    return `${msg.role}: ${msg.content}`;
  }
}
