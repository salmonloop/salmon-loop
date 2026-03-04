/**
 * Incremental summary prompts.
 *
 * Following LangChain's progressive summarization pattern:
 * - New messages are added to existing summary
 * - No need to regenerate entire summary
 */

import type { LLMMessage } from '../../types/llm.js';

/**
 * Input for building incremental summary prompt.
 */
export interface IncrementalSummaryInput {
  /** Current cumulative summary (empty if first time) */
  currentSummary: string;

  /** New messages to incorporate */
  newMessages: LLMMessage[];
}

/**
 * Build prompt for incremental summary.
 *
 * Following LangChain's ConversationSummaryMemory pattern.
 */
export function buildIncrementalSummaryPrompt(input: IncrementalSummaryInput): string {
  const { currentSummary, newMessages } = input;

  const formattedMessages = newMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const outputContract = `Output format (strict):
1) Human summary:
[SUMMARY]
<concise summary text>
[/SUMMARY]
2) Structured state JSON:
[STATE_JSON]
{
  "decisions": [],
  "constraints": [],
  "open_questions": [],
  "pending_tasks": [],
  "rejected_options": [],
  "assumptions": [],
  "risks": [],
  "owner": []
}
[/STATE_JSON]`;

  if (currentSummary) {
    return `Current summary:
${currentSummary}

New lines of conversation:
${formattedMessages}

Updated summary (integrate new information into current summary, keep it concise and focused on key decisions, code changes, and important context).
${outputContract}`;
  }

  return `Summarize this conversation, capturing:
- Key decisions and agreements
- Important code or technical details discussed
- User preferences and constraints mentioned
- Pending tasks or open questions

Conversation:
${formattedMessages}

${outputContract}`;
}

/**
 * Format messages for token counting.
 */
export function formatMessagesForCounting(messages: LLMMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

/**
 * Truncate summary if it exceeds max tokens.
 * Uses a simple character-based estimate for speed.
 */
export function truncateSummary(
  summary: string,
  maxTokens: number,
  countTokens: (text: string) => number,
): string {
  const tokens = countTokens(summary);
  if (tokens <= maxTokens) return summary;

  // Estimate character ratio
  const ratio = maxTokens / tokens;
  const targetChars = Math.floor(summary.length * ratio * 0.9); // 10% safety margin

  // Find a good break point
  const truncated = summary.slice(0, targetChars);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
  );

  const breakPoint = lastSentenceEnd > targetChars * 0.7 ? lastSentenceEnd + 1 : targetChars;

  return summary.slice(0, breakPoint) + '\n\n[Summary truncated for length]';
}
