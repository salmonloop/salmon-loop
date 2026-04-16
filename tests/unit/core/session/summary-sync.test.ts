import { describe, expect, it, mock } from 'bun:test';

import {
  buildEffectiveConversationContext,
  refreshSessionSummary,
} from '../../../../src/core/session/summary-sync.js';
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

    await expect(refreshSessionSummary({ llm, sessionManager: undefined })).resolves.toEqual({
      didSummarize: false,
    });
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

  it('builds canonical effective context from summary state and unsummarized messages', () => {
    const messages = [
      { id: 'm-0', role: 'user', content: 'old user', timestamp: 1 },
      { id: 'm-1', role: 'assistant', content: 'old assistant', timestamp: 2 },
      { id: 'm-2', role: 'user', content: 'recent user', timestamp: 3 },
      { id: 'm-3', role: 'assistant', content: 'recent assistant', timestamp: 4 },
    ];
    const sessionManager = {
      getSummaryState: () => ({
        summary: 'condensed summary',
        summaryTokens: 8,
        summarizedMessageIds: ['m-0', 'm-1'],
        lastSummarizedAt: 100,
        summaryVersion: 2,
        contextHash: 'ctx-999',
        structuredState: {
          decisions: ['keep summary'],
          constraints: [],
          open_questions: [],
          pending_tasks: [],
          rejected_options: [],
          assumptions: [],
          risks: [],
          owner: [],
        },
      }),
      getMessagesWithIds: () => messages,
      getMessages: () => messages,
    };

    const llm: LLM = {
      chat: mock(async () => ({ role: 'assistant' as const, content: 'unused' })),
      createPlan: async () => {
        throw new Error('unused');
      },
      createPatch: async () => {
        throw new Error('unused');
      },
    };

    const context = buildEffectiveConversationContext({
      llm,
      sessionManager: sessionManager as any,
      budgetTokens: 32,
      countTokens: () => 1,
    });

    expect(context[0]).toMatchObject({
      role: 'system',
    });
    expect(context[0]?.content).toContain('Conversation structured state');
    expect(context[1]).toEqual({
      role: 'system',
      content: '[Previous conversation summary]\ncondensed summary',
    });
    expect(context.slice(2)).toEqual([
      { role: 'user', content: 'recent user' },
      { role: 'assistant', content: 'recent assistant' },
    ]);
  });
});
