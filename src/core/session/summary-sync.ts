import { ConversationSummarizer } from '../context/summarization/summarizer.js';
import { DEFAULT_SUMMARIZATION_CONFIG } from '../context/summarization/types.js';
import type { LLM, LLMMessage } from '../types/index.js';

import type { ChatSessionManager } from './manager.js';
import { TokenTracker } from './token-tracker.js';

export async function refreshSessionSummary(params: {
  sessionManager?: ChatSessionManager;
  llm: LLM;
  contextHash?: string;
}): Promise<void> {
  const { sessionManager, llm, contextHash } = params;
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

    const messages = sessionManager.getMessagesWithIds().map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));

    await summarizer.forceSummarize(messages, contextHash);
    sessionManager.updateSummaryState(summarizer.getState());
  } catch {
    // Best-effort summary update: never affect execution flow.
  }
}

export function buildEffectiveConversationContext(params: {
  llm: LLM;
  sessionManager: ChatSessionManager;
}): LLMMessage[] {
  const { sessionManager } = params;
  const summaryState = sessionManager.getSummaryState();
  const messages = sessionManager.getMessagesWithIds().map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  }));

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

  return summarizer
    .getEffectiveContext(messages)
    .map((m) => ({ role: m.role, content: m.content }));
}
