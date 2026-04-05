import { ConversationSummarizer } from '../context/summarization/summarizer.js';
import { DEFAULT_SUMMARIZATION_CONFIG } from '../context/summarization/types.js';
import type { LLM, LLMMessage } from '../types/index.js';

import { microcompact } from './compaction/microcompact.js';
import type { ChatSessionManager } from './manager.js';
import { buildSessionConversationContext } from './session-context-builder.js';
import { TokenTracker } from './token-tracker.js';

export async function refreshSessionSummary(params: {
  sessionManager?: ChatSessionManager;
  llm: LLM;
  contextHash?: string;
  strategy?: 'auto' | 'force';
}): Promise<void> {
  const { sessionManager, llm, contextHash } = params;
  const strategy = params.strategy ?? 'auto';
  if (!sessionManager) return;

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
    const messages = microcompact(rawMessages).map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    if (strategy === 'force') {
      await summarizer.forceSummarize(messages, contextHash);
    } else {
      await summarizer.triggerSummarization(messages, contextHash);
    }
    sessionManager.updateSummaryState(summarizer.getState());
  } catch {
    // Best-effort summary update: never affect execution flow.
  }
}

export function buildEffectiveConversationContext(params: {
  llm: LLM;
  sessionManager: ChatSessionManager;
  budgetTokens?: number;
  maxMessages?: number;
  countTokens?: (text: string) => number;
}): LLMMessage[] {
  const { sessionManager } = params;
  const summaryState = sessionManager.getSummaryState();

  // Apply microcompact (Level 0) to all messages before building context
  // This is a "view-only" operation that doesn't modify sessionManager history
  const rawMessages = sessionManager.getMessages();
  const messages = microcompact(rawMessages).map((msg) => ({
    id: msg.id,
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
