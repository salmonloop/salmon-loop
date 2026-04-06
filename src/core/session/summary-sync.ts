import { ConversationSummarizer } from '../context/summarization/summarizer.js';
import { DEFAULT_SUMMARIZATION_CONFIG } from '../context/summarization/types.js';
import type { LLM, LLMMessage } from '../types/index.js';

import { microcompact } from './compaction/microcompact.js';
import type { ChatSessionManager } from './manager.js';
import { buildSessionConversationContext } from './session-context-builder.js';
import { TokenTracker } from './token-tracker.js';
import type { ChatMessage } from './types.js';

export async function refreshSessionSummary(params: {
  sessionManager?: ChatSessionManager;
  llm: LLM;
  contextHash?: string;
  strategy?: 'auto' | 'force';
  /**
   * When true, rethrow errors instead of swallowing them.
   * Use this for compaction pipelines that need failure tracking/circuit breakers.
   */
  strict?: boolean;
}): Promise<{ didSummarize: boolean; error?: string }> {
  const { sessionManager, llm, contextHash } = params;
  const strategy = params.strategy ?? 'auto';
  if (!sessionManager) return { didSummarize: false };

  try {
    const summarizer = new ConversationSummarizer(
      {
        chat: async ({ messages, temperature, maxTokens }) => {
          const response = await llm.chat(messages, {
            temperature,
            maxTokens,
            phase: 'CONTEXT',
          });
          return { content: response.content };
        },
      },
      {
        count: (text) => TokenTracker.estimateTokens(text),
      },
      {
        ...DEFAULT_SUMMARIZATION_CONFIG,
        async: false,
        summaryModel: {
          model: llm.getModelId?.() ?? 'session-summary',
          temperature: 0,
          maxTokens: DEFAULT_SUMMARIZATION_CONFIG.maxSummaryTokens,
        },
      },
    );

    await summarizer.initialize();
    const persistedState = sessionManager.getSummaryState();
    if (persistedState) {
      summarizer.restoreState(persistedState);
    }

    const rawMessages = sessionManager.getMessagesWithIds();
    const messages = microcompact(rawMessages).map((msg, index) => ({
      id: msg.id ?? rawMessages[index]?.id ?? `msg-${index}-${msg.timestamp}`,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    let didSummarize = false;
    if (strategy === 'force') {
      const result = await summarizer.forceSummarize(messages, contextHash);
      didSummarize = Boolean(result);
    } else {
      const result = await summarizer.triggerSummarization(messages, contextHash);
      didSummarize = Boolean(result);
    }
    sessionManager.updateSummaryState(summarizer.getState());
    return { didSummarize };
  } catch (error) {
    if (params.strict) {
      throw error;
    }
    return { didSummarize: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function buildEffectiveConversationContext(params: {
  llm: LLM;
  sessionManager: ChatSessionManager;
  /**
   * Optional override for the message list used to build context.
   * Useful for retries where the current instruction is already passed separately
   * and should not be duplicated inside the session context slice.
   */
  messages?: ChatMessage[];
  budgetTokens?: number;
  maxMessages?: number;
  countTokens?: (text: string) => number;
}): LLMMessage[] {
  const { sessionManager } = params;
  const summaryState = sessionManager.getSummaryState();

  // Apply microcompact (Level 0) to all messages before building context
  // This is a "view-only" operation that doesn't modify sessionManager history
  const rawMessages = params.messages ?? sessionManager.getMessages();
  const messages = microcompact(rawMessages).map((msg, index) => ({
    id: msg.id ?? `msg-${index}-${msg.timestamp}`,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  }));

  if (!summaryState) {
    return buildSessionConversationContext(messages, {
      budgetTokens: params.budgetTokens ?? Number.MAX_SAFE_INTEGER,
      maxMessages: params.maxMessages,
      countTokens: params.countTokens,
    });
  }

  const summarizer = new ConversationSummarizer(
    {
      chat: async () => ({ content: '' }),
    },
    {
      count: (text) => TokenTracker.estimateTokens(text),
    },
    {
      ...DEFAULT_SUMMARIZATION_CONFIG,
      async: false,
      summaryModel: {
        model: params.llm.getModelId?.() ?? 'session-summary',
        temperature: 0,
        maxTokens: DEFAULT_SUMMARIZATION_CONFIG.maxSummaryTokens,
      },
    },
  );

  if (summaryState) {
    summarizer.restoreState(summaryState);
  }

  const effective = summarizer.getEffectiveContext(messages);
  const recentMessages = effective
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    }));

  return buildSessionConversationContext(recentMessages, {
    budgetTokens: params.budgetTokens ?? Number.MAX_SAFE_INTEGER,
    maxMessages: params.maxMessages,
    countTokens: params.countTokens,
    summaryState,
  });
}
