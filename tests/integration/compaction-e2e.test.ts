import { mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ChatSessionManager } from '../../src/core/session/manager.js';
import { buildEffectiveConversationContext, refreshSessionSummary } from '../../src/core/session/summary-sync.js';
import { createInitialTracking, onNormalTurnComplete } from '../../src/core/session/compaction/tracking.js';
import { runCompactionPipeline } from '../../src/core/session/compaction/index.js';
import { TokenTracker } from '../../src/core/session/token-tracker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Compaction Pipeline End-to-End', () => {
  const testDir = join(__dirname, '../tmp/compaction-e2e');
  const sessionsDir = join(testDir, '.salmonloop', 'chat-sessions');

  let sessionManager: ChatSessionManager;
  const mockLLM = {
    getModelId: () => 'test-model',
    chat: vi.fn(),
  } as any;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    sessionManager = new ChatSessionManager(testDir);
    await sessionManager.init();
    await sessionManager.create('E2E Test Session');
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('should apply tiered compaction (Level 0 + Level 1) correctly', async () => {
    // 1. Setup a long history with many tool results
    for (let i = 0; i < 10; i++) {
      sessionManager.addMessage({
        role: 'user',
        content: `Instruction ${i}`,
        timestamp: Date.now() + i * 1000,
      });
      sessionManager.addMessage({
        role: 'assistant',
        content: `I am doing stuff ${i}.\n<tool_result name="ls">file_${i}.txt</tool_result>`,
        timestamp: Date.now() + i * 1000 + 500,
      });
    }

    let tracking = createInitialTracking();

    // Mock token count to trigger Level 1 (threshold is 8000)
    const estimateSpy = vi.spyOn(TokenTracker, 'estimateMessagesTokens').mockReturnValue(10000);

    // Mock LLM for summarization
    mockLLM.chat.mockResolvedValue({ content: '[SUMMARY]This is a summary[/SUMMARY][STATE_JSON]{}[/STATE_JSON]' });

    // 2. Run Pipeline (Level 1 Autocompact)
    const pipelineResult = await runCompactionPipeline({
      sessionManager,
      llm: mockLLM,
      tracking,
      contextHash: 'h1',
    });

    expect(pipelineResult.performed).toBe(true);
    expect(pipelineResult.tracking.compacted).toBe(true);
    expect(mockLLM.chat).toHaveBeenCalled(); // Level 1 triggered

    tracking = pipelineResult.tracking;

    // 3. Build Effective Context (Level 0 Microcompact)
    const context = buildEffectiveConversationContext({
      llm: mockLLM,
      sessionManager,
      budgetTokens: 10000,
    });

    // Debug output
    console.log('Context length:', context.length);
    console.log('Context content samples:', context.map(m => m.content.slice(0, 100)));

    // Check if the summary is present (Level 1 result)
    expect(context.some(m => m.content.includes('This is a summary'))).toBe(true);

    // Check if tool results are cleared in the messages part of the context
    const assistantMessages = context.filter(m => m.role === 'assistant');
    // The very last assistant message should NOT be cleared (keepRecentTurns: 3 default)
    expect(assistantMessages[assistantMessages.length - 1].content).toContain('file_9.txt');

    // Some older assistant message that was NOT summarized but kept as recent should be cleared
    // With 10 rounds, many are summarized, but some are kept as "recent" (summarizer.config.keepRecentMessages)
    // The summarizer keeps 10 messages (5 rounds).
    // Microcompact keeps 3 rounds (6 messages).
    // So there should be messages that are "recent" for summarizer but "old" for microcompact.

    const clearedMessages = assistantMessages.filter(m => m.content.includes('[Previous tool output cleared'));
    expect(clearedMessages.length).toBeGreaterThan(0);

    // 4. Verify original history is UNTOUCHED
    const originalMessages = sessionManager.getMessages();
    // Assistant message was at index 1 in each round
    expect(originalMessages[1].content).toContain('file_0.txt');
    expect(originalMessages[1].content).not.toContain('[Previous tool output cleared');

    estimateSpy.mockRestore();
  });
});
