import { describe, expect, it, mock } from 'bun:test';

import { refreshSessionSummary } from '../../../../src/core/session/summary-sync.js';
import type { LLM } from '../../../../src/core/types/index.js';

function createMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message-${i}`,
    timestamp: Date.now() + i,
  }));
}

describe('summary-sync', () => {
  it('updates persisted summary state with structured summary and contextHash', async () => {
    let persistedState: any;
    const sessionManager = {
      getSummaryState: () => undefined,
      getMessagesWithIds: () => createMessages(20),
      updateSummaryState: (state: any) => {
        persistedState = state;
      },
    };

    const llm: LLM = {
      chat: mock().mockResolvedValue({
        role: 'assistant',
        content: `[SUMMARY]
Session summary
[/SUMMARY]
[STATE_JSON]
{"decisions":["d1"],"constraints":["c1"],"open_questions":[],"pending_tasks":[],"rejected_options":[],"assumptions":[],"risks":[],"owner":["agent"]}
[/STATE_JSON]`,
      }),
      createPlan: async () => {
        throw new Error('unused');
      },
      createPatch: async () => {
        throw new Error('unused');
      },
    };

    await refreshSessionSummary({
      sessionManager: sessionManager as any,
      llm,
      contextHash: 'ctx-123',
      strategy: 'force',
    });

    expect(persistedState).toBeDefined();
    expect(persistedState.contextHash).toBe('ctx-123');
    expect(persistedState.structuredState.decisions).toEqual(['d1']);
  });

  it('is no-op when session manager is missing', async () => {
    const llm: LLM = {
      chat: async () => ({ role: 'assistant', content: 'ok' }),
      createPlan: async () => {
        throw new Error('unused');
      },
      createPatch: async () => {
        throw new Error('unused');
      },
    };

    await expect(
      refreshSessionSummary({ llm, sessionManager: undefined }),
    ).resolves.toBeUndefined();
  });

  it('does not call llm in auto mode when trigger threshold is not met', async () => {
    let persistedState: any;
    const sessionManager = {
      getSummaryState: () => undefined,
      getMessagesWithIds: () => createMessages(4),
      updateSummaryState: (state: any) => {
        persistedState = state;
      },
    };

    const chat = mock().mockResolvedValue({
      role: 'assistant',
      content: 'should-not-be-called',
    });
    const llm: LLM = {
      chat,
      createPlan: async () => {
        throw new Error('unused');
      },
      createPatch: async () => {
        throw new Error('unused');
      },
    };

    await refreshSessionSummary({
      sessionManager: sessionManager as any,
      llm,
      strategy: 'auto',
    });

    expect(chat).not.toHaveBeenCalled();
    expect(persistedState).toBeDefined();
  });
});
