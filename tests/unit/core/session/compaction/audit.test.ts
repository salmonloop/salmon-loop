import { describe, it, expect, vi, beforeEach } from 'vitest';
import { microcompact } from '../../../../../src/core/session/compaction/microcompact.js';
import { autocompact } from '../../../../../src/core/session/compaction/index.js';
import { getLogger } from '../../../../../src/core/observability/logger.js';
import { TokenTracker } from '../../../../../src/core/session/token-tracker.js';
import * as summarySync from '../../../../../src/core/session/summary-sync.js';
import { createInitialTracking } from '../../../../../src/core/session/compaction/tracking.js';

vi.mock('../../../../../src/core/observability/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    audit: vi.fn(),
  }),
}));

vi.mock('../../../../../src/core/session/token-tracker.js', () => ({
  TokenTracker: {
    estimateMessagesTokens: vi.fn(),
    estimateTokens: (s: string) => Math.ceil(s.length / 4),
  },
}));

vi.mock('../../../../../src/core/session/summary-sync.js', () => ({
  refreshSessionSummary: vi.fn(),
}));

describe('Compaction Audit Logging', () => {
  const mockAudit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getLogger as any).mockReturnValue({ audit: mockAudit } as any);
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
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(10000);
    const mockSessionManager = {
      getMessages: vi.fn().mockReturnValue([]),
      getSummaryState: vi.fn().mockReturnValue({ summaryTokens: 500 }),
    } as any;

    await autocompact({
      sessionManager: mockSessionManager,
      llm: { getModelId: () => 'unknown' } as any,
      tracking: createInitialTracking(),
      config: { tokenThreshold: 5000 },
    });

    expect(mockAudit).toHaveBeenCalledWith(
      'COMPACTION_AUTOCOMPACT',
      expect.objectContaining({ preTokens: 10000, summaryTokens: 500 }),
      expect.objectContaining({ phase: 'COMPACTION' })
    );
  });

  it('should use dynamic threshold from LLM model ID', async () => {
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(35000);
    const mockSessionManager = {
      getMessages: vi.fn().mockReturnValue([]),
      getSummaryState: vi.fn().mockReturnValue({ summaryTokens: 1000 }),
    } as any;

    // Claude 3.5 Sonnet has a recommended budget of 40,000 in adaptive-budget.ts
    // 35,000 < 40,000, so it should NOT perform compaction
    const result = await autocompact({
      sessionManager: mockSessionManager,
      llm: { getModelId: () => 'claude-3.5-sonnet' } as any,
      tracking: createInitialTracking(),
    });

    expect(result.performed).toBe(false);
    expect(mockAudit).not.toHaveBeenCalledWith('COMPACTION_AUTOCOMPACT', expect.anything(), expect.anything());

    // 45,000 > 40,000, so it SHOULD perform compaction
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(45000);
    const result2 = await autocompact({
      sessionManager: mockSessionManager,
      llm: { getModelId: () => 'claude-3.5-sonnet' } as any,
      tracking: createInitialTracking(),
    });

    expect(result2.performed).toBe(true);
    expect(mockAudit).toHaveBeenCalledWith(
      'COMPACTION_AUTOCOMPACT',
      expect.objectContaining({ preTokens: 45000 }),
      expect.anything()
    );
  });

  it('should log COMPACTION_FAILURE when errors occur', async () => {
    (TokenTracker.estimateMessagesTokens as any).mockReturnValue(10000);
    (summarySync.refreshSessionSummary as any).mockRejectedValue(new Error('LLM Failed'));

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
