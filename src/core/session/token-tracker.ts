import path from 'path';

import { FileAdapter } from '../adapters/fs/index.js';
import { logIgnoredError } from '../observability/ignored-error.js';
import type { LoopResult } from '../types/index.js';
import type { TokenUsage } from '../types/usage.js';

import type { ChatSession } from './types.js';

/**
 * Token usage tracker for chat sessions.
 * Extracts and accumulates token statistics from LLM execution results.
 */
export class TokenTracker {
  private static readonly fileAdapter = new FileAdapter();

  /**
   * Extract token usage from LoopResult
   * Strategies (in order of priority):
   * 1. Parse from result metadata (if available)
   * 2. Estimate based on content length (fallback)
   */
  static async extractFromResult(result: LoopResult): Promise<TokenUsage | null> {
    if (result.usage) return result.usage;
    if (!result.auditPath) return null;

    try {
      const auditRaw = await this.fileAdapter.readFile(result.auditPath, 'utf8');
      const audit = JSON.parse(auditRaw) as any;
      const eventsRef = audit?.context?.eventsRef;
      if (!eventsRef || typeof eventsRef.path !== 'string') return null;

      const eventsPath = path.isAbsolute(eventsRef.path)
        ? eventsRef.path
        : path.join(path.dirname(result.auditPath), eventsRef.path);
      const eventsRaw = await this.fileAdapter.readFile(eventsPath, 'utf8');
      const events = eventsRaw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));

      let inputTokens = 0;
      let outputTokens = 0;

      for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        if ((event as any).action !== 'llm.usage') continue;
        const details = (event as any).details;
        if (!details || typeof details !== 'object') continue;

        const promptTokens = (details as any).promptTokens;
        const completionTokens = (details as any).completionTokens;
        if (typeof promptTokens === 'number' && Number.isFinite(promptTokens)) {
          inputTokens += promptTokens;
        }
        if (typeof completionTokens === 'number' && Number.isFinite(completionTokens)) {
          outputTokens += completionTokens;
        }
      }

      if (inputTokens === 0 && outputTokens === 0) return null;

      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
    } catch (error) {
      logIgnoredError(`[TokenTracker] Failed to extract usage from ${result.auditPath}`, error);
      return null;
    }
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

  /**
   * Estimate total tokens for a list of messages
   */
  static estimateMessagesTokens(messages: Array<{ content: string }>): number {
    return messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
  }
}
