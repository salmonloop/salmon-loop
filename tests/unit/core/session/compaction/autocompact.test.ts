import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autocompact } from '../../../../../src/core/session/compaction/index.js';
import { createInitialTracking } from '../../../../../src/core/session/compaction/tracking.js';
import { TokenTracker } from '../../../../../src/core/session/token-tracker.js';
import * as summarySync from '../../../../../src/core/session/summary-sync.js';
import * as adaptiveBudget from '../../../../../src/core/context/token/adaptive-budget.js';
import { setLogger, createLogger } from '../../../../../src/core/observability/logger.js';

vi.mock('../../../../../src/core/session/token-tracker.js', () => ({
  TokenTracker: {
    estimateMessagesTokens: vi.fn(),
  },
}));

vi.mock('../../../../../src/core/session/summary-sync.js', () => ({
  refreshSessionSummary: vi.fn(),
}));

vi.mock('../../../../../src/core/context/token/adaptive-budget.js', () => ({
  getModelRecommendedBudget: vi.fn(),
}));

describe('autocompact & pipeline', () => {
  beforeEach(() => {
    setLogger(createLogger({ silent: true }));
    vi.clearAllMocks();
  });

  const mockSessionManager = {
    getMessages: vi.fn().mockReturnValue([]),
    getCurrent: vi.fn(),
    updateSummaryState: vi.fn(),
    save: vi.fn(),
    getSummaryState: vi.fn().mockReturnValue({ summaryTokens: 100 }),
  } as any;

  const mockLLM = {
    getModelId: vi.fn().mockReturnValue('test-model'),
  } as any;

  it('should use dynamic threshold from adaptive budget if not provided', async () => {
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(15000);
    (adaptiveBudget.getModelRecommendedBudget as any).mockReturnValue(20000);
    const tracking = createInitialTracking();

    // With 15k tokens and 20k threshold, it should NOT perform compaction
    const result = await autocompact({
      sessionManager: mockSessionManager,
      llm: mockLLM,
      tracking,
      // No config.tokenThreshold provided
    });

    expect(adaptiveBudget.getModelRecommendedBudget).toHaveBeenCalledWith('test-model');
    expect(result.performed).toBe(false);
  });

  it('should trigger compaction if tokens exceed dynamic threshold', async () => {
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(25000);
    (adaptiveBudget.getModelRecommendedBudget as any).mockReturnValue(20000);
    const tracking = createInitialTracking();

    // With 25k tokens and 20k threshold, it SHOULD perform compaction
    const result = await autocompact({
      sessionManager: mockSessionManager,
      llm: mockLLM,
      tracking,
    });

    expect(result.performed).toBe(true);
    expect(summarySync.refreshSessionSummary).toHaveBeenCalled();
  });

  it('should skip autocompact if tokens are below threshold', async () => {
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(1000);
    const tracking = createInitialTracking();

    const result = await autocompact({
      sessionManager: mockSessionManager,
      llm: mockLLM,
      tracking,
      config: { tokenThreshold: 5000 },
    });

    expect(result.performed).toBe(false);
    expect(summarySync.refreshSessionSummary).not.toHaveBeenCalled();
  });

  it('should trigger autocompact if tokens exceed threshold', async () => {
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(10000);
    const tracking = createInitialTracking();

    const result = await autocompact({
      sessionManager: mockSessionManager,
      llm: mockLLM,
      tracking,
      config: { tokenThreshold: 5000 },
    });

    expect(result.performed).toBe(true);
    expect(result.tracking.compacted).toBe(true);
    expect(summarySync.refreshSessionSummary).toHaveBeenCalledWith(expect.objectContaining({
      strategy: 'force'
    }));
  });

  it('should trip circuit breaker after max failures', async () => {
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(10000);
    (summarySync.refreshSessionSummary as any).mockRejectedValue(new Error('LLM Error'));

    let tracking = createInitialTracking();

    // 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      const result = await autocompact({
        sessionManager: mockSessionManager,
        llm: mockLLM,
        tracking,
        config: { tokenThreshold: 5000, maxFailures: 3 },
      });
      tracking = result.tracking;
    }

    expect(tracking.consecutiveFailures).toBe(3);

    // 4th attempt should be skipped by circuit breaker
    const finalResult = await autocompact({
      sessionManager: mockSessionManager,
      llm: mockLLM,
      tracking,
      config: { tokenThreshold: 5000, maxFailures: 3 },
    });

    expect(finalResult.performed).toBe(false);
    expect(finalResult.tracking.consecutiveFailures).toBe(3); // stays at 3
  });
});
