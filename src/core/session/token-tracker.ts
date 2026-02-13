import type { LoopResult } from '../types/index.js';

import type { ChatSession } from './types.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Token usage tracker for chat sessions.
 * Extracts and accumulates token statistics from LLM execution results.
 */
export class TokenTracker {
  /**
   * Extract token usage from LoopResult
   * Strategies (in order of priority):
   * 1. Parse from result metadata (if available)
   * 2. Estimate based on content length (fallback)
   */
  static extractFromResult(_result: LoopResult): TokenUsage | null {
    // Strategy 1: Check if result has token metadata
    // Note: This depends on LLM implementation returning token info
    // For now, we return null as placeholder for future implementation

    // TODO: Implement actual token extraction when LLM returns usage data
    // Example from OpenAI: result.usage = { prompt_tokens, completion_tokens }

    return null;
  }

  /**
   * Accumulate tokens into session metadata
   */
  static accumulate(session: ChatSession, usage: TokenUsage): void {
    session.meta.totalTokens.input += usage.inputTokens;
    session.meta.totalTokens.output += usage.outputTokens;
  }

  /**
   * Estimate token count based on text length
   * Rough approximation: 1 token ≈ 4 characters (for English text)
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
