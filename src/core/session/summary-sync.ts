import { ConversationSummarizer } from '../context/summarization/summarizer.js';
import { DEFAULT_SUMMARIZATION_CONFIG } from '../context/summarization/types.js';
import type { LLM, LLMMessage } from '../types/index.js';

import { microcompact } from './compaction/microcompact.js';
import type { ChatSessionManager } from './manager.js';
import { buildSessionConversationContext } from './session-context-builder.js';
import { TokenTracker } from './token-tracker.js';
import type { ChatMessage, RecoveryFailureSummary, RecoveryState, SummaryState } from './types.js';

const MAX_RECOVERY_READ_FILES = 6;
const MAX_RECOVERY_SAFE_HINT_CHARS = 240;

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function clampText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeFailureSummary(
  value: RecoveryFailureSummary | null | undefined,
): RecoveryFailureSummary | undefined {
  if (!value) return undefined;

  const next: RecoveryFailureSummary = {};
  const reasonCode = trimToUndefined(value.reasonCode);
  if (reasonCode) next.reasonCode = reasonCode;
  const diagnosticCode = trimToUndefined(value.diagnosticCode);
  if (diagnosticCode) next.diagnosticCode = diagnosticCode;
  const safeHint = clampText(trimToUndefined(value.safeHint), MAX_RECOVERY_SAFE_HINT_CHARS);
  if (safeHint) next.safeHint = safeHint;
  const failurePhase = trimToUndefined(value.failurePhase);
  if (failurePhase) next.failurePhase = failurePhase;

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeRecentReadFiles(
  value:
    | Array<{
        path: string;
      }>
    | string[]
    | undefined,
): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const path = trimToUndefined(typeof entry === 'string' ? entry : entry?.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }

  if (unique.length === 0) return undefined;
  return unique.slice(-MAX_RECOVERY_READ_FILES);
}

function buildRecoveryState(params: {
  sessionManager: ChatSessionManager;
  persistedState?: SummaryState;
  patch?: {
    lastFailureSummary?: RecoveryFailureSummary | null;
  };
}): RecoveryState | undefined {
  const { sessionManager, persistedState, patch } = params;
  const next: RecoveryState = {};

  const flowMode = sessionManager.getChatFlowMode?.() ?? persistedState?.recoveryState?.flowMode;
  if (flowMode) {
    next.flowMode = flowMode;
  }

  const recentReadFiles = normalizeRecentReadFiles(
    sessionManager.getArtifactState?.()?.recentReadArtifacts ??
      persistedState?.recoveryState?.recentReadFiles,
  );
  if (recentReadFiles?.length) {
    next.recentReadFiles = recentReadFiles;
  }

  const lastFailureSummary =
    patch && 'lastFailureSummary' in patch
      ? normalizeFailureSummary(patch.lastFailureSummary)
      : normalizeFailureSummary(persistedState?.recoveryState?.lastFailureSummary);
  if (lastFailureSummary) {
    next.lastFailureSummary = lastFailureSummary;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function buildRecoveryStateMessage(summaryState: SummaryState | undefined): LLMMessage | undefined {
  const recoveryState = summaryState?.recoveryState;
  if (!recoveryState) return undefined;
  return {
    role: 'system',
    content: `[Conversation recovery state]\n${JSON.stringify(recoveryState)}`,
  };
}

function fitRecoveryStateMessage(params: {
  message: LLMMessage | undefined;
  budgetTokens: number;
  countTokens: (text: string) => number;
}): LLMMessage | undefined {
  const { message, budgetTokens, countTokens } = params;
  if (!message) return undefined;
  if (budgetTokens <= 0) return undefined;
  const tokens = Math.max(0, Math.floor(countTokens(message.content)));
  return tokens <= budgetTokens ? message : undefined;
}

export async function refreshSessionSummary(params: {
  sessionManager?: ChatSessionManager;
  llm: LLM;
  contextHash?: string;
  strategy?: 'auto' | 'force';
  recoveryStatePatch?: {
    lastFailureSummary?: RecoveryFailureSummary | null;
  };
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
    const nextState = summarizer.getState();
    nextState.recoveryState = buildRecoveryState({
      sessionManager,
      persistedState,
      patch: params.recoveryStatePatch,
    });
    sessionManager.updateSummaryState(nextState);
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
  const countTokens = params.countTokens ?? ((text: string) => TokenTracker.estimateTokens(text));

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
      countTokens,
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

  const recoveryMessage = fitRecoveryStateMessage({
    message: buildRecoveryStateMessage(summaryState),
    budgetTokens: params.budgetTokens ?? Number.MAX_SAFE_INTEGER,
    countTokens,
  });
  const recoveryBudget =
    recoveryMessage && params.budgetTokens !== undefined
      ? Math.max(
          0,
          params.budgetTokens - Math.max(0, Math.floor(countTokens(recoveryMessage.content))),
        )
      : params.budgetTokens;

  const summaryStateForContext =
    summaryState.recoveryState === undefined
      ? summaryState
      : {
          ...summaryState,
          recoveryState: undefined,
        };

  const built = buildSessionConversationContext(recentMessages, {
    budgetTokens: recoveryBudget ?? Number.MAX_SAFE_INTEGER,
    maxMessages: params.maxMessages,
    countTokens,
    summaryState: summaryStateForContext,
  });

  if (!recoveryMessage) return built;

  let systemPrefixLength = 0;
  while (systemPrefixLength < built.length && built[systemPrefixLength]?.role === 'system') {
    systemPrefixLength += 1;
  }

  return [
    ...built.slice(0, systemPrefixLength),
    recoveryMessage,
    ...built.slice(systemPrefixLength),
  ];
}
