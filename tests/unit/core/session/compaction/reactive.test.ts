import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { LlmError } from '../../../../../src/core/llm/errors.js';
import { setLogger, createLogger } from '../../../../../src/core/observability/logger.js';
import { createInitialTracking } from '../../../../../src/core/session/compaction/tracking.js';

const refreshSessionSummary = mock();

mock.module('../../../../../src/core/session/summary-sync.js', () => ({
  refreshSessionSummary,
}));

describe('reactiveCompact', () => {
  beforeEach(() => {
    setLogger(createLogger({ silent: true }));
    mock.clearAllMocks();
  });

  function createMockSessionManager() {
    return {
      getMessages: mock().mockReturnValue([]),
      getSummaryState: mock().mockReturnValue({ summaryTokens: 100 }),
    } as any;
  }

  it('ignores non-overflow errors', async () => {
    const { reactiveCompact } = await import('../../../../../src/core/session/compaction/index.js');

    const result = await reactiveCompact({
      sessionManager: createMockSessionManager(),
      llm: { getModelId: () => 'test-model' } as any,
      error: new Error('Random error'),
      tracking: createInitialTracking(),
    });

    expect(result.performed).toBe(false);
  });

  it('triggers compaction on context length exceeded error', async () => {
    const { reactiveCompact } = await import('../../../../../src/core/session/compaction/index.js');

    refreshSessionSummary.mockResolvedValue({ didSummarize: true });

    const result = await reactiveCompact({
      sessionManager: createMockSessionManager(),
      llm: { getModelId: () => 'test-model' } as any,
      error: new LlmError('Context overflow', 'LLM_CONTEXT_LENGTH_EXCEEDED'),
      tracking: createInitialTracking(),
    });

    expect(result.performed).toBe(true);
    expect(result.trigger).toBe('reactive');
    expect(refreshSessionSummary).toHaveBeenCalled();
  });

  it('triggers compaction on plain overflow message errors', async () => {
    const { reactiveCompact } = await import('../../../../../src/core/session/compaction/index.js');

    refreshSessionSummary.mockResolvedValue({ didSummarize: true });

    const result = await reactiveCompact({
      sessionManager: createMockSessionManager(),
      llm: { getModelId: () => 'test-model' } as any,
      error: new Error('Prompt is too long'),
      tracking: createInitialTracking(),
    });

    expect(result.performed).toBe(true);
    expect(result.trigger).toBe('reactive');
    expect(refreshSessionSummary).toHaveBeenCalled();
  });
});
