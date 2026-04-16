import { getModelRecommendedBudget } from '../../context/token/adaptive-budget.js';
import { LlmError } from '../../llm/errors.js';
import { getLogger } from '../../observability/logger.js';
import type { LLM } from '../../types/index.js';
import type { ChatSessionManager } from '../manager.js';
import { refreshSessionSummary } from '../summary-sync.js';
import { TokenTracker } from '../token-tracker.js';

import { isCircuitBreakerTripped, onCompactionFailure, onCompactionSuccess } from './tracking.js';
import type { CompactionTracking, CompactionResult, AutocompactConfig } from './types.js';
import { DEFAULT_AUTOCOMPACT_CONFIG } from './types.js';

function isContextOverflowLike(error: unknown): boolean {
  if (error instanceof LlmError && error.llmCode === 'LLM_CONTEXT_LENGTH_EXCEEDED') {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && typeof (error as any).message === 'string'
        ? String((error as any).message)
        : '';
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('maximum context length') ||
    lower.includes('context length') ||
    lower.includes('too many tokens') ||
    lower.includes('prompt is too long') ||
    lower.includes('input is too long') ||
    lower.includes('reduce the length') ||
    lower.includes('please reduce')
  );
}

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
  const { sessionManager, llm, tracking, contextHash } = params;
  const trigger = params.trigger ?? 'auto';
  const modelId = llm.getModelId?.();

  // Resolve dynamic threshold if not provided in config
  let resolvedThreshold = params.config?.tokenThreshold;
  if (resolvedThreshold === undefined) {
    if (modelId) {
      try {
        resolvedThreshold = getModelRecommendedBudget(modelId);
      } catch (_error) {
        // Fallback to default if resolution fails
        resolvedThreshold = DEFAULT_AUTOCOMPACT_CONFIG.tokenThreshold;
      }
    } else {
      resolvedThreshold = DEFAULT_AUTOCOMPACT_CONFIG.tokenThreshold;
    }
  }

  const config: AutocompactConfig = {
    ...DEFAULT_AUTOCOMPACT_CONFIG,
    ...params.config,
    tokenThreshold: resolvedThreshold,
  };

  // 1. Check circuit breaker
  if (isCircuitBreakerTripped(tracking, config.maxFailures)) {
    getLogger().audit(
      'COMPACTION_SKIP',
      {
        reason: 'circuit_breaker',
        trigger,
        modelId: modelId ?? 'unknown',
        tokenThreshold: config.tokenThreshold,
        consecutiveFailures: tracking.consecutiveFailures,
        maxFailures: config.maxFailures,
      },
      {
        source: 'session',
        severity: 'low',
        scope: 'session',
        phase: 'COMPACTION',
      },
    );
    return { performed: false, tracking };
  }

  // 2. Check threshold (only for auto trigger)
  const messages = sessionManager.getMessages();
  const totalTokens = TokenTracker.estimateMessagesTokens(messages);

  if (trigger === 'auto' && totalTokens < config.tokenThreshold) {
    getLogger().audit(
      'COMPACTION_SKIP',
      {
        reason: 'below_threshold',
        trigger,
        modelId: modelId ?? 'unknown',
        preTokens: totalTokens,
        tokenThreshold: config.tokenThreshold,
      },
      {
        source: 'session',
        severity: 'low',
        scope: 'session',
        phase: 'COMPACTION',
      },
    );
    return { performed: false, tracking };
  }

  // 3. Perform summarization
  try {
    // Reuse existing refreshSessionSummary with 'force' strategy
    // This will trigger the ConversationSummarizer logic
    const summaryResult = await refreshSessionSummary({
      sessionManager,
      llm,
      contextHash,
      strategy: 'force',
      strict: true,
    });

    if (!summaryResult.didSummarize) {
      getLogger().audit(
        'COMPACTION_SKIP',
        {
          reason: 'no_op',
          trigger,
          modelId: modelId ?? 'unknown',
          preTokens: totalTokens,
          tokenThreshold: config.tokenThreshold,
        },
        {
          source: 'session',
          severity: 'low',
          scope: 'session',
          phase: 'COMPACTION',
        },
      );
      return { performed: false, tracking };
    }

    const updatedSummary = sessionManager.getSummaryState();

    getLogger().audit(
      `COMPACTION_${trigger.toUpperCase()}COMPACT` as any,
      {
        trigger,
        modelId: modelId ?? 'unknown',
        preTokens: totalTokens,
        tokenThreshold: config.tokenThreshold,
        summaryTokens: updatedSummary?.summaryTokens,
        circuitBreakerState: { consecutiveFailures: 0 },
      },
      {
        source: 'session',
        severity: 'medium',
        scope: 'session',
        phase: 'COMPACTION',
      },
    );

    return {
      performed: true,
      tracking: onCompactionSuccess(tracking),
      preTokens: totalTokens,
      trigger: trigger as any,
    };
  } catch (error) {
    const newTracking = onCompactionFailure(tracking);
    getLogger().audit(
      'COMPACTION_FAILURE',
      {
        error: error instanceof Error ? error.message : String(error),
        consecutiveFailures: newTracking.consecutiveFailures,
        trigger,
      },
      {
        source: 'session',
        severity: 'medium',
        scope: 'session',
        phase: 'COMPACTION',
      },
    );

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
  if (!isContextOverflowLike(params.error)) {
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
