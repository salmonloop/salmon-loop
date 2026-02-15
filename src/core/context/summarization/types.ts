/**
 * Summarization types and interfaces.
 *
 * Design Principles:
 * - Incremental summarization (progressive)
 * - Async execution (non-blocking)
 * - Model-agnostic configuration
 */

import type { LLMMessage } from '../../types/index.js';
import type { SummaryModelConfig } from '../token/types.js';

/**
 * Summarization configuration.
 * Based on industry best practices:
 * - Trigger at token threshold
 * - Pre-trigger at 90% for async execution
 * - Keep recent messages in original form
 */
export interface SummarizationConfig {
  /** Trigger summary when token count exceeds this threshold */
  triggerTokens: number;

  /** Pre-trigger at this ratio of triggerTokens (e.g., 0.9 = 90%) */
  preTriggerRatio: number;

  /** Number of recent messages to keep in original form */
  keepRecentMessages: number;

  /** Model configuration for summarization */
  summaryModel: SummaryModelConfig;

  /** Whether to run summarization asynchronously */
  async: boolean;

  /** Maximum messages to summarize in one batch */
  maxBatchSize: number;

  /** Maximum tokens for summary output */
  maxSummaryTokens: number;
}

/**
 * Default configuration based on research best practices.
 * - 3500 token threshold (leaving room for system prompt)
 * - 90% pre-trigger for smooth UX
 * - 10 recent messages (5 rounds)
 * - Async execution by default
 */
export const DEFAULT_SUMMARIZATION_CONFIG: SummarizationConfig = {
  triggerTokens: 3500,
  preTriggerRatio: 0.9,
  keepRecentMessages: 10,
  summaryModel: {
    model: '', // Set by caller, not hardcoded
    temperature: 0,
    maxTokens: 500,
  },
  async: true,
  maxBatchSize: 8,
  maxSummaryTokens: 500,
};

/**
 * Summary state persisted across sessions.
 */
export interface SummaryState {
  /** Current cumulative summary */
  summary: string;

  /** Token count of current summary */
  summaryTokens: number;

  /** Message IDs already summarized */
  summarizedMessageIds: string[];

  /** Last summary timestamp */
  lastSummarizedAt: number;
}

/**
 * Result of summarization operation.
 */
export interface SummarizationResult {
  /** New summary text */
  summary: string;

  /** Number of messages summarized */
  messagesSummarized: number;

  /** Tokens before summarization */
  tokensBefore: number;

  /** Tokens after summarization */
  tokensAfter: number;

  /** Token reduction achieved */
  tokenReduction: number;

  /** Whether it was async */
  async: boolean;
}

/**
 * Message with metadata for summarization.
 */
export interface SummarizableMessage extends LLMMessage {
  /** Unique identifier for tracking */
  id: string;

  /** Timestamp for ordering */
  timestamp: number;
}

/**
 * LLM client interface for summarization.
 * Abstracted to avoid coupling to specific LLM implementation.
 */
export interface SummarizationLLMClient {
  chat(params: {
    model: string;
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ content: string }>;
}

/**
 * Token counter interface for summarization.
 * Abstracted to use the token module.
 */
export interface SummarizationTokenCounter {
  count(text: string): number;
}
