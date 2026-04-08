import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { setLogger } from '../../../../../src/core/observability/logger.js';
import { microcompact } from '../../../../../src/core/session/compaction/microcompact.js';
import { createInitialTracking } from '../../../../../src/core/session/compaction/tracking.js';
import { TokenTracker } from '../../../../../src/core/session/token-tracker.js';

describe('compaction audit logging', () => {
  const audit = mock();

  beforeEach(() => {
    mock.clearAllMocks();
    setLogger({ audit } as any);
  });

  it('logs COMPACTION_MICROCOMPACT when messages are cleared', () => {
    const messages = [
      { role: 'assistant', content: '<tool_result name="ls">output</tool_result>', timestamp: 100 },
      { role: 'assistant', content: 'recent', timestamp: 200 },
    ];

    microcompact(messages as any, { keepRecentTurns: 0 });

    expect(audit).toHaveBeenCalledWith(
      'COMPACTION_MICROCOMPACT',
      expect.objectContaining({ clearedCount: 1 }),
      expect.objectContaining({ phase: 'COMPACTION' }),
    );
  });

  it('logs COMPACTION_AUTOCOMPACT when level 1 triggers', async () => {
    const { autocompact } = await import('../../../../../src/core/session/compaction/index.js');
    const summarySync = await import('../../../../../src/core/session/summary-sync.js');

    spyOn(TokenTracker, 'estimateMessagesTokens').mockReturnValue(10000);
    spyOn(summarySync, 'refreshSessionSummary').mockResolvedValue({ didSummarize: true } as any);

    const mockSessionManager = {
      getMessages: mock().mockReturnValue([]),
      getSummaryState: mock().mockReturnValue({ summaryTokens: 500 }),
    } as any;

    await autocompact({
      sessionManager: mockSessionManager,
      llm: { getModelId: () => 'unknown' } as any,
      tracking: createInitialTracking(),
      config: { tokenThreshold: 5000 },
    });

    expect(audit).toHaveBeenCalledWith(
      'COMPACTION_AUTOCOMPACT',
      expect.objectContaining({ preTokens: 10000, summaryTokens: 500 }),
      expect.objectContaining({ phase: 'COMPACTION' }),
    );
  });

  it('logs COMPACTION_FAILURE when refresh throws in strict mode', async () => {
    const { autocompact } = await import('../../../../../src/core/session/compaction/index.js');
    const summarySync = await import('../../../../../src/core/session/summary-sync.js');

    spyOn(TokenTracker, 'estimateMessagesTokens').mockReturnValue(10000);
    spyOn(summarySync, 'refreshSessionSummary').mockImplementation(() => {
      throw new Error('LLM Failed');
    });

    const mockSessionManager = {
      getMessages: mock().mockReturnValue([]),
      getSummaryState: mock().mockReturnValue(undefined),
    } as any;

    await autocompact({
      sessionManager: mockSessionManager,
      llm: { getModelId: () => 'unknown' } as any,
      tracking: createInitialTracking(),
      config: { tokenThreshold: 5000 },
    });

    expect(audit).toHaveBeenCalledWith(
      'COMPACTION_FAILURE',
      expect.objectContaining({ error: 'LLM Failed' }),
      expect.objectContaining({ phase: 'COMPACTION' }),
    );
  });
});

