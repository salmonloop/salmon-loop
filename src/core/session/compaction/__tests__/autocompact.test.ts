import { describe, it, expect, vi } from 'vitest';
import { autocompact, runCompactionPipeline } from '../index.js';
import { createInitialTracking, onCompactionFailure } from '../tracking.js';
import { TokenTracker } from '../../token-tracker.js';
import * as summarySync from '../../summary-sync.js';

vi.mock('../../token-tracker.js', () => ({
  TokenTracker: {
    estimateMessagesTokens: vi.fn(),
  },
}));

vi.mock('../../summary-sync.js', () => ({
  refreshSessionSummary: vi.fn(),
}));

describe('autocompact & pipeline', () => {
  const mockSessionManager = {
    getMessages: vi.fn(),
    getCurrent: vi.fn(),
    updateSummaryState: vi.fn(),
    save: vi.fn(),
  } as any;

  const mockLLM = {
    getModelId: () => 'test-model',
  } as any;

  it('should skip autocompact if tokens are below threshold', async () => {
    vi.mocked(TokenTracker.estimateMessagesTokens).mockReturnValue(1000);
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
    vi.mocked(TokenTracker.estimateMessagesTokens).mockReturnValue(10000);
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
    vi.mocked(TokenTracker.estimateMessagesTokens).mockReturnValue(10000);
    vi.mocked(summarySync.refreshSessionSummary).mockRejectedValue(new Error('LLM Error'));

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
