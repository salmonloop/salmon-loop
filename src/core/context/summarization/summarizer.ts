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
  StructuredSummaryState,
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
      summaryVersion: 2,
      structuredState: this.createEmptyStructuredState(),
      contextHash: undefined,
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
      summaryVersion: this.state.summaryVersion,
      structuredState: this.state.structuredState
        ? { ...this.state.structuredState }
        : this.createEmptyStructuredState(),
      contextHash: this.state.contextHash,
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
      summaryVersion: state.summaryVersion ?? 2,
      structuredState: state.structuredState
        ? this.normalizeStructuredState(state.structuredState)
        : this.createEmptyStructuredState(),
      contextHash: state.contextHash,
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
      summaryVersion: 2,
      structuredState: this.createEmptyStructuredState(),
      contextHash: undefined,
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

    // 1. Add structured state if exists
    if (this.state.structuredState && this.hasStructuredStateContent(this.state.structuredState)) {
      result.push({
        id: 'summary-state',
        role: 'system',
        content:
          `[Conversation structured state v${this.state.summaryVersion ?? 2}]` +
          `\ncontextHash=${this.state.contextHash ?? 'none'}\n` +
          JSON.stringify(this.state.structuredState),
        timestamp: this.state.lastSummarizedAt,
      });
    }

    // 2. Add human-readable summary if exists
    if (this.state.summary) {
      result.push({
        id: 'summary',
        role: 'system',
        content: `[Previous conversation summary]\n${this.state.summary}`,
        timestamp: this.state.lastSummarizedAt,
      });
    }

    // 3. Add recent messages not yet summarized
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
  async triggerSummarization(
    messages: SummarizableMessage[],
    contextHash?: string,
  ): Promise<SummarizationResult | null> {
    if (this.summaryInProgress) {
      logger.debug('[Summarizer] Summary already in progress, skipping');
      return null;
    }

    this.ensureStateAligned(contextHash);
    if (!this.shouldTrigger(messages)) {
      return null;
    }

    if (this.config.async) {
      // Fire and forget
      this.runSummarization(messages, contextHash).catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[Summarizer] Async summarization failed: ${errMsg}`);
      });
      return null;
    }

    return this.runSummarization(messages, contextHash);
  }

  /**
   * Force summarization now (for session end or explicit request).
   */
  async forceSummarize(
    messages: SummarizableMessage[],
    contextHash?: string,
  ): Promise<SummarizationResult | null> {
    this.ensureStateAligned(contextHash);
    if (messages.length <= this.config.keepRecentMessages) {
      return null;
    }
    return this.runSummarization(messages, contextHash);
  }

  /**
   * Run incremental summarization.
   */
  private async runSummarization(
    messages: SummarizableMessage[],
    contextHash?: string,
  ): Promise<SummarizationResult> {
    this.summaryInProgress = true;

    try {
      this.ensureStateAligned(contextHash);

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
        currentSummary: this.composeCurrentSummaryForPrompt(),
        newMessages: batch,
      });

      const response = await this.llm.chat({
        model: this.config.summaryModel.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.summaryModel.temperature ?? 0,
        maxTokens: this.config.maxSummaryTokens,
      });

      const parsed = this.parseSummaryResponse(response.content);
      let newSummary = parsed.summary;
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
      this.state.structuredState = parsed.structuredState;
      this.state.contextHash = contextHash;
      this.state.summaryVersion = 2;
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

  private composeCurrentSummaryForPrompt(): string {
    if (!this.state.summary && !this.state.structuredState) {
      return '';
    }

    const structured = this.state.structuredState
      ? `\n\nCurrent structured state:\n${JSON.stringify(this.state.structuredState)}`
      : '';
    return `${this.state.summary}${structured}`;
  }

  private ensureStateAligned(contextHash?: string): void {
    if (!contextHash) return;
    if (!this.state.contextHash || this.state.contextHash === contextHash) return;

    logger.warn(
      `[Summarizer] Context hash changed (${this.state.contextHash} -> ${contextHash}), rebuilding summary state`,
    );
    this.state.summary = '';
    this.state.summaryTokens = 0;
    this.state.summarizedMessageIds = [];
    this.state.structuredState = this.createEmptyStructuredState();
    this.state.contextHash = undefined;
    this.state.lastSummarizedAt = 0;
  }

  private parseSummaryResponse(content: string): {
    summary: string;
    structuredState: StructuredSummaryState;
  } {
    const summaryMatch = content.match(/\[SUMMARY\]([\s\S]*?)\[\/SUMMARY\]/);
    const summary = (summaryMatch?.[1] ?? content).trim();

    const stateMatch = content.match(/\[STATE_JSON\]([\s\S]*?)\[\/STATE_JSON\]/);
    if (!stateMatch?.[1]) {
      return { summary, structuredState: this.createEmptyStructuredState() };
    }

    try {
      const parsed = JSON.parse(stateMatch[1]);
      return { summary, structuredState: this.normalizeStructuredState(parsed) };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[Summarizer] Failed to parse structured summary state: ${errMsg}`);
      return { summary, structuredState: this.createEmptyStructuredState() };
    }
  }

  private normalizeStructuredState(input: unknown): StructuredSummaryState {
    const normalized = this.createEmptyStructuredState();
    if (!input || typeof input !== 'object') return normalized;

    const source = input as Record<string, unknown>;
    normalized.decisions = this.ensureStringArray(source.decisions);
    normalized.constraints = this.ensureStringArray(source.constraints);
    normalized.open_questions = this.ensureStringArray(source.open_questions);
    normalized.pending_tasks = this.ensureStringArray(source.pending_tasks);
    normalized.rejected_options = this.ensureStringArray(source.rejected_options);
    normalized.assumptions = this.ensureStringArray(source.assumptions);
    normalized.risks = this.ensureStringArray(source.risks);
    normalized.owner = this.ensureStringArray(source.owner);
    return normalized;
  }

  private ensureStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }

  private createEmptyStructuredState(): StructuredSummaryState {
    return {
      decisions: [],
      constraints: [],
      open_questions: [],
      pending_tasks: [],
      rejected_options: [],
      assumptions: [],
      risks: [],
      owner: [],
    };
  }

  private hasStructuredStateContent(state: StructuredSummaryState): boolean {
    return (
      state.decisions.length > 0 ||
      state.constraints.length > 0 ||
      state.open_questions.length > 0 ||
      state.pending_tasks.length > 0 ||
      state.rejected_options.length > 0 ||
      state.assumptions.length > 0 ||
      state.risks.length > 0 ||
      state.owner.length > 0
    );
  }
}
