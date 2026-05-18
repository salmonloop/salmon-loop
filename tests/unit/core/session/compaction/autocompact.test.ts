import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { setLogger, createLogger } from '../../../../../src/core/observability/logger.js';
import { createInitialTracking } from '../../../../../src/core/session/compaction/tracking.js';

const estimateMessagesTokens = mock();
const refreshSessionSummary = mock();
const getModelRecommendedBudget = mock();

mock.module('../../../../../src/core/session/token-tracker.js', () => ({
  TokenTracker: {
    estimateMessagesTokens,
  },
}));

mock.module('../../../../../src/core/session/summary-sync.js', () => ({
  refreshSessionSummary,
}));

mock.module('../../../../../src/core/context/token/adaptive-budget.js', () => ({
  getModelRecommendedBudget,
}));

describe('autocompact', () => {
  beforeEach(() => {
    setLogger(createLogger({ silent: true }));
    mock.restore();
  });

  function createMockSessionManager() {
    return {
      getMessages: mock().mockReturnValue([]),
      getSummaryState: mock().mockReturnValue({ summaryTokens: 100 }),
    } as any;
  }

  it('uses dynamic threshold from adaptive budget when unset', async () => {
    const { autocompact } = await import('../../../../../src/core/session/compaction/index.js');

    estimateMessagesTokens.mockReturnValue(15000);
    getModelRecommendedBudget.mockReturnValue(20000);

    const result = await autocompact({
      sessionManager: createMockSessionManager(),
      llm: { getModelId: () => 'test-model' } as any,
      tracking: createInitialTracking(),
    });

    expect(getModelRecommendedBudget).toHaveBeenCalledWith('test-model');
    expect(result.performed).toBe(false);
  });

  it('triggers when tokens exceed dynamic threshold', async () => {
    const { autocompact } = await import('../../../../../src/core/session/compaction/index.js');

    estimateMessagesTokens.mockReturnValue(25000);
    getModelRecommendedBudget.mockReturnValue(20000);
    refreshSessionSummary.mockResolvedValue({ didSummarize: true });

    const result = await autocompact({
      sessionManager: createMockSessionManager(),
      llm: { getModelId: () => 'test-model' } as any,
      tracking: createInitialTracking(),
    });

    expect(result.performed).toBe(true);
    expect(refreshSessionSummary).toHaveBeenCalled();
  });

  it('skips when tokens are below explicit threshold', async () => {
    const { autocompact } = await import('../../../../../src/core/session/compaction/index.js');

    estimateMessagesTokens.mockReturnValue(1000);

    const result = await autocompact({
      sessionManager: createMockSessionManager(),
      llm: { getModelId: () => 'test-model' } as any,
      tracking: createInitialTracking(),
      config: { tokenThreshold: 5000 },
    });

    expect(result.performed).toBe(false);
    expect(refreshSessionSummary).not.toHaveBeenCalled();
  });

  it('trips circuit breaker after max failures', async () => {
    const { autocompact } = await import('../../../../../src/core/session/compaction/index.js');

    estimateMessagesTokens.mockReturnValue(10000);
    refreshSessionSummary.mockImplementation(() => {
      throw new Error('LLM Error');
    });

    let tracking = createInitialTracking();
    for (let i = 0; i < 3; i++) {
      const result = await autocompact({
        sessionManager: createMockSessionManager(),
        llm: { getModelId: () => 'test-model' } as any,
        tracking,
        config: { tokenThreshold: 5000, maxFailures: 3 },
      });
      tracking = result.tracking;
    }

    expect(tracking.consecutiveFailures).toBe(3);

    const finalResult = await autocompact({
      sessionManager: createMockSessionManager(),
      llm: { getModelId: () => 'test-model' } as any,
      tracking,
      config: { tokenThreshold: 5000, maxFailures: 3 },
    });

    expect(finalResult.performed).toBe(false);
    expect(finalResult.tracking.consecutiveFailures).toBe(3);
  });
});
