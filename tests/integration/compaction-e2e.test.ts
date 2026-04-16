import { mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { runCompactionPipeline } from '../../src/core/session/compaction/index.js';
import { createInitialTracking } from '../../src/core/session/compaction/tracking.js';
import { ChatSessionManager } from '../../src/core/session/manager.js';
import { buildEffectiveConversationContext } from '../../src/core/session/summary-sync.js';
import { TokenTracker } from '../../src/core/session/token-tracker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Compaction Pipeline End-to-End', () => {
  const testDir = join(__dirname, '../tmp/compaction-e2e');
  const sessionsDir = join(testDir, '.salmonloop', 'chat-sessions');

  let sessionManager: ChatSessionManager;
  const mockLLM = {
    getModelId: () => 'test-model',
    chat: mock(),
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
    } catch (_error) {
      // Ignore cleanup errors in tests.
    }
  });

  it('should apply tiered compaction (Level 0 + Level 1) correctly', async () => {
    // 1. Setup a long history with large assistant messages.
    // Note: production SalmonLoop does not embed `<tool_result>` tags in persisted session history.
    // This test focuses on Level 1 summarization + effective context trimming.
    for (let i = 0; i < 10; i++) {
      sessionManager.addMessage({
        role: 'user',
        content: `Instruction ${i}`,
        timestamp: Date.now() + i * 1000,
      });
      sessionManager.addMessage({
        role: 'assistant',
        content: `I am doing stuff ${i}.\n` + 'x'.repeat(4000),
        timestamp: Date.now() + i * 1000 + 500,
      });
    }

    let tracking = createInitialTracking();

    // Mock token count to trigger Level 1 (threshold is 8000)
    const estimateSpy = spyOn(TokenTracker, 'estimateMessagesTokens').mockReturnValue(25000);

    // Mock LLM for summarization
    (mockLLM.chat as any).mockResolvedValue({
      content: '[SUMMARY]This is a summary[/SUMMARY][STATE_JSON]{}[/STATE_JSON]',
    });

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

    // 3. Build Effective Context (includes summary + recent tail)
    const context = buildEffectiveConversationContext({
      llm: mockLLM,
      sessionManager,
      budgetTokens: 10000,
    });

    // Check if the summary is present (Level 1 result)
    expect(context.some((m) => m.content.includes('This is a summary'))).toBe(true);

    // The oldest messages should not appear in the effective context (summarized away).
    expect(context.some((m) => m.content.includes('Instruction 0'))).toBe(false);
    expect(context.some((m) => m.content.includes('I am doing stuff 0'))).toBe(false);
    // The most recent tail should still appear.
    expect(context.some((m) => m.content.includes('Instruction 9'))).toBe(true);
    expect(context.some((m) => m.content.includes('I am doing stuff 9'))).toBe(true);

    // 4. Verify original history is UNTOUCHED
    const originalMessages = sessionManager.getMessages();
    // Assistant message was at index 1 in each round
    expect(originalMessages[1].content).toContain('I am doing stuff 0');
    expect(originalMessages[1].content).toContain('x'.repeat(100));

    estimateSpy.mockRestore();
  });
});
