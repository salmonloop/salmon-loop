import { TokenBudgetCalculator } from '../context/token/token-budget.js';
import type { LLMMessage } from '../types/index.js';

import type { ChatMessage, SummaryState } from './types.js';

export interface SessionContextBuilderOptions {
  /**
   * Total token budget reserved for session history injection.
   * This is a soft budget: tokens are approximated unless a precise counter is injected.
   */
  budgetTokens: number;
  /**
   * Maximum number of messages to include after truncation.
   */
  maxMessages?: number;
  /**
   * Optional token counter override (useful for testing or precise counting).
   * If not provided, a deterministic rough approximation is used.
   */
  countTokens?: (text: string) => number;
  /**
   * Optional persisted summary state. When present, a structured summary system
   * message is prepended before conversational turns (budget permitting).
   */
  summaryState?: SummaryState;
}

export const DEFAULT_SESSION_CONTEXT_BUDGET_FRACTION = 0.15;
export const DEFAULT_SESSION_CONTEXT_MIN_TOKENS = 256;
export const DEFAULT_SESSION_CONTEXT_MAX_TOKENS = 4096;

function clampInt(value: number, min: number, max: number): number {
  const v = Math.floor(value);
  return Math.max(min, Math.min(max, v));
}

export function getDefaultSessionContextBudgetTokens(params: { modelId?: string }): number {
  const calculator = new TokenBudgetCalculator();
  if (typeof params.modelId === 'string' && params.modelId.trim()) {
    calculator.setModel(params.modelId);
  }

  const recommended = calculator.getDefaultBudget();
  const derived = recommended * DEFAULT_SESSION_CONTEXT_BUDGET_FRACTION;
  return clampInt(derived, DEFAULT_SESSION_CONTEXT_MIN_TOKENS, DEFAULT_SESSION_CONTEXT_MAX_TOKENS);
}

function defaultCountTokens(textValue: string): number {
  // Deterministic approximation for English-ish text. This matches our existing conventions.
  return Math.ceil(textValue.length / 4);
}

function toSafeHistoryMessage(msg: ChatMessage): LLMMessage | null {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.role !== 'user' && msg.role !== 'assistant') return null;
  if (typeof msg.content !== 'string') return null;
  const content = msg.content.trimEnd();
  if (!content) return null;
  return { role: msg.role, content };
}

/**
 * Build a deterministic conversation context slice from a persisted session.
 *
 * Notes:
 * - Only includes `user` and `assistant` messages.
 * - Drops a leading `assistant` message to avoid starting mid-turn.
 * - Uses a soft token budget with a deterministic approximation unless overridden.
 */
export function buildSessionConversationContext(
  messages: ChatMessage[],
  options: SessionContextBuilderOptions,
): LLMMessage[] {
  const history = Array.isArray(messages) ? messages.map(toSafeHistoryMessage).filter(Boolean) : [];
  if (history.length === 0) return [];

  const maxMessages = clampInt(options.maxMessages ?? 32, 1, 256);
  const budgetTokens = Math.max(0, Math.floor(options.budgetTokens));
  if (budgetTokens === 0) return [];

  const count = options.countTokens ?? defaultCountTokens;

  let remaining = budgetTokens;
  const selectedReversed: LLMMessage[] = [];

  for (let i = history.length - 1; i >= 0; i--) {
    if (selectedReversed.length >= maxMessages) break;
    const msg = history[i] as LLMMessage;
    const tokens = Math.max(0, Math.floor(count(msg.content)));

    if (tokens <= remaining) {
      selectedReversed.push(msg);
      remaining -= tokens;
      continue;
    }

    if (selectedReversed.length === 0) {
      // If a single message doesn't fit, include a deterministic prefix slice.
      const maxChars = Math.max(0, remaining * 4);
      if (maxChars >= 16) {
        selectedReversed.push({ role: msg.role, content: msg.content.slice(0, maxChars) });
      }
    }
    break;
  }

  const selected = selectedReversed.reverse();
  while (selected.length > 0 && selected[0].role === 'assistant') {
    selected.shift();
  }

  const summaryMessages = buildSummaryMessages(options.summaryState);
  if (summaryMessages.length === 0) {
    return selected;
  }

  const selectedTokens = selected.reduce(
    (sum, msg) => sum + Math.max(0, Math.floor(count(msg.content))),
    0,
  );
  let budgetLeftForSummary = Math.max(0, budgetTokens - selectedTokens);
  const prepended: LLMMessage[] = [];
  for (const msg of summaryMessages) {
    if (budgetLeftForSummary <= 0) break;
    const fullTokens = Math.max(0, Math.floor(count(msg.content)));
    if (fullTokens <= budgetLeftForSummary) {
      prepended.push(msg);
      budgetLeftForSummary -= fullTokens;
      continue;
    }

    const maxChars = Math.max(0, budgetLeftForSummary * 4);
    if (maxChars >= 16) {
      prepended.push({ role: 'system', content: msg.content.slice(0, maxChars) });
    }
    budgetLeftForSummary = 0;
  }

  return [...prepended, ...selected];
}

function buildSummaryMessages(summaryState?: SummaryState): LLMMessage[] {
  if (!summaryState) return [];

  const messages: LLMMessage[] = [];
  const structured = summaryState.structuredState;
  if (structured) {
    messages.push({
      role: 'system',
      content:
        `[Conversation structured state v${summaryState.summaryVersion ?? 2}]` +
        `\ncontextHash=${summaryState.contextHash ?? 'none'}\n` +
        JSON.stringify(structured),
    });
  }

  const summaryText = typeof summaryState.summary === 'string' ? summaryState.summary.trim() : '';
  if (summaryText) {
    messages.push({
      role: 'system',
      content: `[Previous conversation summary]\n${summaryText}`,
    });
  }

  return messages;
}
