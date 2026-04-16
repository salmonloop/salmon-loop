import { getLogger } from '../../observability/logger.js';
import type { ChatMessage } from '../types.js';

import type { MicrocompactConfig } from './types.js';
import { DEFAULT_MICROCOMPACT_CONFIG } from './types.js';

/**
 * Microcompact is a rule-based context reduction utility.
 * It's idempotent, zero-LLM-cost, and operates on the "View" layer.
 *
 * Rules:
 * - Only affects messages with role === 'assistant' that contain tool results.
 * - Preserves the most recent `keepRecentTurns` rounds.
 * - EXCLUDES "stateful" tools (e.g. cd, export) to avoid environment desync.
 * - Preserves the assistant's thought process (the text part) before tools.
 */
export function microcompact(
  messages: ChatMessage[],
  config: Partial<MicrocompactConfig> = {},
): ChatMessage[] {
  const mergedConfig: MicrocompactConfig = {
    ...DEFAULT_MICROCOMPACT_CONFIG,
    ...config,
  };

  const { keepRecentTurns, placeholder, statefulTools } = mergedConfig;

  // 1. Identify cutoff turn (1 turn = user + assistant pair, usually)
  // We'll keep the last N assistant messages as "recent"
  let assistantCount = 0;
  const cutoffIndex = [...messages].reverse().findIndex((msg) => {
    if (msg.role === 'assistant') {
      assistantCount++;
    }
    return assistantCount > keepRecentTurns;
  });

  // Calculate the absolute index in the original array
  const absCutoffIndex = cutoffIndex === -1 ? -1 : messages.length - 1 - cutoffIndex;

  let totalClearedCount = 0;
  const result = messages.map((msg, index) => {
    // Only process assistant messages BEFORE the cutoff
    if (index > absCutoffIndex || msg.role !== 'assistant' || !msg.content) {
      return msg;
    }

    const { content } = msg;

    // Pattern to match tool results while capturing tool name and content
    // Improved regex to handle attributes more robustly
    const toolResultRegex = /<tool_result\b[^>]*?name="([^"]+)"[^>]*?>([\s\S]*?)<\/tool_result>/g;

    let hasMatched = false;
    const newContent = content.replace(toolResultRegex, (match, toolName, toolOutput) => {
      // Rule: Skip stateful tools
      if (statefulTools.includes(toolName)) {
        return match;
      }

      // Rule: Skip if already cleared
      if (toolOutput.trim() === placeholder) {
        return match;
      }

      hasMatched = true;
      totalClearedCount++;

      // Extract original tag prefix (including attributes) to preserve them
      const tagMatch = match.match(/<tool_result\b[^>]*?>/);
      const tagPrefix = tagMatch ? tagMatch[0] : `<tool_result name="${toolName}">`;

      return `${tagPrefix}${placeholder}</tool_result>`;
    });

    if (!hasMatched) {
      return msg;
    }

    return {
      ...msg,
      content: newContent,
    };
  });

  if (totalClearedCount > 0) {
    getLogger().audit(
      'COMPACTION_MICROCOMPACT',
      {
        clearedCount: totalClearedCount,
        keepRecentTurns,
      },
      {
        source: 'session',
        severity: 'low',
        scope: 'session',
        phase: 'COMPACTION',
      },
    );
  }

  return result;
}
