import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { ChatSessionManager } from '../../src/core/session/manager.js';
import { buildEffectiveConversationContext } from '../../src/core/session/summary-sync.js';
import type { LLM } from '../../src/core/types/index.js';

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-session-flow-resume-'));
  tempRoots.push(root);
  return root;
}

describe('Session flow mode resume (integration)', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores chat flow mode after resume', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();
    const session = await manager.create('Flow Resume');

    manager.updateChatFlowMode('debug');
    await manager.save();

    const resumedManager = new ChatSessionManager(repoPath);
    await resumedManager.init();
    const resumed = await resumedManager.resumeSession(session.meta.id);

    expect(resumed.meta.chatState?.flowMode).toBe('debug');
    expect(resumedManager.getChatFlowMode()).toBe('debug');
  });

  it('rehydrates persisted recovery state into effective context after resume', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();
    const session = await manager.create('Flow Resume Recovery');

    manager.updateChatFlowMode('debug');
    manager.updateArtifactState({
      recentReadArtifacts: [
        {
          path: 'src/debug.ts',
          artifact: {
            handle: 's8p://artifact/read-debug',
            mimeType: 'text/plain',
            sha256: 'read-debug',
            size: 10,
          },
        },
      ],
    });
    manager.updateSummaryState({
      summary: 'condensed summary',
      summaryTokens: 4,
      summarizedMessageIds: [],
      lastSummarizedAt: Date.now(),
      summaryVersion: 2,
      contextHash: 'ctx-resume',
      structuredState: {
        decisions: [],
        constraints: [],
        open_questions: [],
        pending_tasks: [],
        rejected_options: [],
        assumptions: [],
        risks: [],
        owner: [],
      },
      recoveryState: {
        flowMode: 'debug',
        lastFailureSummary: {
          reasonCode: 'TOOL_CORRECTION_REQUIRED',
          diagnosticCode: 'TOOL_ARGUMENT_CORRECTION_NEEDED',
          safeHint: 'Adjust the arguments and retry.',
          failurePhase: 'PATCH',
        },
        recentReadFiles: ['src/debug.ts'],
      },
    } as any);
    manager.addMessage({
      role: 'user',
      content: 'recent user',
      timestamp: Date.now(),
    });
    manager.addMessage({
      role: 'assistant',
      content: 'recent assistant',
      timestamp: Date.now() + 1,
    });
    await manager.save();

    const resumedManager = new ChatSessionManager(repoPath);
    await resumedManager.init();
    await resumedManager.resumeSession(session.meta.id);

    const llm: LLM = {
      chat: async () => ({ role: 'assistant', content: 'unused' }),
      createPlan: async () => {
        throw new Error('unused');
      },
      createPatch: async () => {
        throw new Error('unused');
      },
    };

    const context = buildEffectiveConversationContext({
      llm,
      sessionManager: resumedManager,
      budgetTokens: 64,
      countTokens: () => 1,
    });

    expect(
      context.some(
        (message) =>
          message.role === 'system' &&
          message.content.includes('[Conversation recovery state]') &&
          message.content.includes('"flowMode":"debug"') &&
          message.content.includes('"recentReadFiles":["src/debug.ts"]'),
      ),
    ).toBe(true);
  });
});
