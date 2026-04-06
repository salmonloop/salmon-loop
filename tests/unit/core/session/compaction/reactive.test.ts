import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactiveCompact } from '../../../../../src/core/session/compaction/index.js';
import { LlmError } from '../../../../../src/core/llm/errors.js';
import { createInitialTracking } from '../../../../../src/core/session/compaction/tracking.js';
import * as summarySync from '../../../../../src/core/session/summary-sync.js';
import { setLogger, createLogger } from '../../../../../src/core/observability/logger.js';

vi.mock('../../../../../src/core/session/summary-sync.js', () => ({
  refreshSessionSummary: vi.fn(),
}));

describe('reactiveCompact', () => {
  beforeEach(() => {
    setLogger(createLogger({ silent: true }));
  });
  const mockSessionManager = {
    getMessages: vi.fn().mockReturnValue([]),
    getSummaryState: vi.fn().mockReturnValue({ summaryTokens: 100 }),
  } as any;

  const mockLLM = {
    getModelId: () => 'test-model',
  } as any;

  it('should ignore non-overflow errors', async () => {
    const error = new Error('Random error');
    const result = await reactiveCompact({
      sessionManager: mockSessionManager,
      llm: mockLLM,
      error,
      tracking: createInitialTracking(),
    });

    expect(result.performed).toBe(false);
  });

  it('should trigger compaction on context length exceeded error', async () => {
    const error = new LlmError('Context overflow', 'LLM_CONTEXT_LENGTH_EXCEEDED');

    const result = await reactiveCompact({
      sessionManager: mockSessionManager,
      llm: mockLLM,
      error,
      tracking: createInitialTracking(),
    });

    expect(result.performed).toBe(true);
    expect(result.trigger).toBe('reactive');
    expect(summarySync.refreshSessionSummary).toHaveBeenCalled();
  });
});
