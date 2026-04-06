import { getLogger } from '../../observability/logger.js';
import type { ChatSessionManager } from '../manager.js';
import type { LLM } from '../../types/index.js';
import { LlmError } from '../../llm/errors.js';
import type { CompactionTracking, CompactionResult, AutocompactConfig } from './types.js';
import { DEFAULT_AUTOCOMPACT_CONFIG } from './types.js';
import { isCircuitBreakerTripped, onCompactionFailure, onCompactionSuccess } from './tracking.js';
import { TokenTracker } from '../token-tracker.js';
import { refreshSessionSummary } from '../summary-sync.js';

/**
 * Autocompact (Level 1)
 *
 * Triggered when token count exceeds threshold.
 * Uses existing summarization infrastructure to reduce context.
 */
export async function autocompact(params: {
  sessionManager: ChatSessionManager;
  llm: LLM;
  tracking: CompactionTracking;
  config?: Partial<AutocompactConfig>;
  contextHash?: string;
  trigger?: 'auto' | 'reactive';
  signal?: AbortSignal;
}): Promise<CompactionResult> {
  const { sessionManager, llm, tracking, contextHash, signal } = params;
  const trigger = params.trigger ?? 'auto';
  const config: AutocompactConfig = {
    ...DEFAULT_AUTOCOMPACT_CONFIG,
    ...params.config,
  };

  // 1. Check circuit breaker
  if (isCircuitBreakerTripped(tracking, config.maxFailures)) {
    return { performed: false, tracking };
  }

  // 2. Check threshold (only for auto trigger)
  const messages = sessionManager.getMessages();
  const totalTokens = TokenTracker.estimateMessagesTokens(messages);

  if (trigger === 'auto' && totalTokens < config.tokenThreshold) {
    return { performed: false, tracking };
  }

  // 3. Perform summarization
  try {
    // Reuse existing refreshSessionSummary with 'force' strategy
    // This will trigger the ConversationSummarizer logic
    await refreshSessionSummary({
      sessionManager,
      llm,
      contextHash,
      strategy: 'force',
    });

    const postMessages = sessionManager.getMessages(); // Still original history
    const updatedSummary = sessionManager.getSummaryState();

    getLogger().audit(`COMPACTION_${trigger.toUpperCase()}COMPACT` as any, {
      trigger,
      preTokens: totalTokens,
      summaryTokens: updatedSummary?.summaryTokens,
      circuitBreakerState: { consecutiveFailures: 0 },
    }, {
      source: 'session',
      severity: 'medium',
      scope: 'session',
      phase: 'COMPACTION'
    });

    return {
      performed: true,
      tracking: onCompactionSuccess(tracking),
      preTokens: totalTokens,
      trigger: trigger as any,
    };
  } catch (error) {
    const newTracking = onCompactionFailure(tracking);
    getLogger().audit('COMPACTION_FAILURE', {
      error: error instanceof Error ? error.message : String(error),
      consecutiveFailures: newTracking.consecutiveFailures,
      trigger,
    }, {
      source: 'session',
      severity: 'medium',
      scope: 'session',
      phase: 'COMPACTION'
    });

    return {
      performed: false,
      tracking: newTracking,
    };
  }
}

/**
 * Reactive Compact (Level 2)
 *
 * Emergency compaction when LLM returns prompt-too-long error.
 */
export async function reactiveCompact(params: {
  sessionManager: ChatSessionManager;
  llm: LLM;
  error: unknown;
  tracking: CompactionTracking;
  contextHash?: string;
  signal?: AbortSignal;
}): Promise<CompactionResult> {
  const { error } = params;

  const isOverflow =
    error instanceof LlmError && error.llmCode === 'LLM_CONTEXT_LENGTH_EXCEEDED';

  if (!isOverflow) {
    return { performed: false, tracking: params.tracking };
  }

  return autocompact({
    ...params,
    trigger: 'reactive',
  });
}

/**
 * Main Compaction Pipeline entry point
 */
export async function runCompactionPipeline(params: {
  sessionManager: ChatSessionManager;
  llm: LLM;
  tracking: CompactionTracking;
  contextHash?: string;
  signal?: AbortSignal;
}): Promise<CompactionResult> {
  // Level 0 (Microcompact) is already integrated into buildEffectiveConversationContext
  // and refreshSessionSummary.

  // Level 1: Autocompact
  return autocompact(params);
}
