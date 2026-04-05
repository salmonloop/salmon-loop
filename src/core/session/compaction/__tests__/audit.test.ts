import { describe, it, expect, vi, beforeEach } from 'vitest';
import { microcompact } from '../microcompact.js';
import { autocompact } from '../index.js';
import { getLogger } from '../../../observability/logger.js';
import { TokenTracker } from '../../token-tracker.js';
import * as summarySync from '../../summary-sync.js';
import { createInitialTracking } from '../tracking.js';

vi.mock('../../../observability/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    audit: vi.fn(),
  }),
}));

vi.mock('../../token-tracker.js', () => ({
  TokenTracker: {
    estimateMessagesTokens: vi.fn(),
    estimateTokens: (s: string) => Math.ceil(s.length / 4),
  },
}));

vi.mock('../../summary-sync.js', () => ({
  refreshSessionSummary: vi.fn(),
}));

describe('Compaction Audit Logging', () => {
  const mockAudit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLogger).mockReturnValue({ audit: mockAudit } as any);
  });

  it('should log COMPACTION_MICROCOMPACT when messages are cleared', () => {
    const messages = [
      { role: 'assistant', content: '<tool_result name="ls">output</tool_result>', timestamp: 100 },
      { role: 'assistant', content: 'recent', timestamp: 200 },
    ];

    // keepRecentTurns: 0 to force clearing the first message
    microcompact(messages as any, { keepRecentTurns: 0 });

    expect(mockAudit).toHaveBeenCalledWith(
      'COMPACTION_MICROCOMPACT',
      expect.objectContaining({ clearedCount: 1 }),
      expect.objectContaining({ phase: 'COMPACTION' })
    );
  });

  it('should log COMPACTION_AUTOCOMPACT when level 1 triggers', async () => {
    vi.mocked(TokenTracker.estimateMessagesTokens).mockReturnValue(10000);
    const mockSessionManager = {
      getMessages: vi.fn().mockReturnValue([]),
      getSummaryState: vi.fn().mockReturnValue({ summaryTokens: 500 }),
    } as any;

    await autocompact({
      sessionManager: mockSessionManager,
      llm: {} as any,
      tracking: createInitialTracking(),
      config: { tokenThreshold: 5000 },
    });

    expect(mockAudit).toHaveBeenCalledWith(
      'COMPACTION_AUTOCOMPACT',
      expect.objectContaining({ preTokens: 10000, summaryTokens: 500 }),
      expect.objectContaining({ phase: 'COMPACTION' })
    );
  });

  it('should log COMPACTION_FAILURE when errors occur', async () => {
    vi.mocked(TokenTracker.estimateMessagesTokens).mockReturnValue(10000);
    vi.mocked(summarySync.refreshSessionSummary).mockRejectedValue(new Error('LLM Failed'));

    const mockSessionManager = {
      getMessages: vi.fn().mockReturnValue([]),
    } as any;

    await autocompact({
      sessionManager: mockSessionManager,
      llm: {} as any,
      tracking: createInitialTracking(),
      config: { tokenThreshold: 5000 },
    });

    expect(mockAudit).toHaveBeenCalledWith(
      'COMPACTION_FAILURE',
      expect.objectContaining({ error: 'LLM Failed' }),
      expect.objectContaining({ phase: 'COMPACTION' })
    );
  });
});
