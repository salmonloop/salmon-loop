import { getLogger } from '../../observability/logger.js';
import type { ChatSessionManager } from '../manager.js';
import type { LLM } from '../../types/index.js';
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
  signal?: AbortSignal;
}): Promise<CompactionResult> {
  const { sessionManager, llm, tracking, contextHash, signal } = params;
  const config: AutocompactConfig = {
    ...DEFAULT_AUTOCOMPACT_CONFIG,
    ...params.config,
  };

  // 1. Check circuit breaker
  if (isCircuitBreakerTripped(tracking, config.maxFailures)) {
    return { performed: false, tracking };
  }

  // 2. Check threshold
  const messages = sessionManager.getMessages();
  const totalTokens = TokenTracker.estimateMessagesTokens(messages);

  if (totalTokens < config.tokenThreshold) {
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

    getLogger().audit('COMPACTION_AUTOCOMPACT', {
      trigger: 'auto',
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
      trigger: 'auto',
    };
  } catch (error) {
    const newTracking = onCompactionFailure(tracking);
    getLogger().audit('COMPACTION_FAILURE', {
      error: error instanceof Error ? error.message : String(error),
      consecutiveFailures: newTracking.consecutiveFailures,
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
