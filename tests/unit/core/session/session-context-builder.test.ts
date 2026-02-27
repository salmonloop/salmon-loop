import { describe, expect, it } from 'bun:test';

import {
  buildSessionConversationContext,
  getDefaultSessionContextBudgetTokens,
} from '../../../../src/core/session/session-context-builder.js';

describe('session-context-builder', () => {
  it('derives a model-adaptive default budget (recommendedBudget-based)', () => {
    expect(getDefaultSessionContextBudgetTokens({ modelId: 'gpt-3.5-turbo' })).toBe(1800);
    expect(getDefaultSessionContextBudgetTokens({ modelId: 'gpt-4o' })).toBe(4096);
  });

  it('packs messages from the end within budget deterministically', () => {
    const messages = [
      { role: 'user', content: 'one', timestamp: 1 },
      { role: 'assistant', content: 'two', timestamp: 2 },
      { role: 'user', content: 'three', timestamp: 3 },
      { role: 'assistant', content: 'four', timestamp: 4 },
    ] as any[];

    const ctx = buildSessionConversationContext(messages as any, {
      budgetTokens: 2,
      countTokens: (t: string) => (t ? 1 : 0),
    });

    expect(ctx).toEqual([
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ]);
  });

  it('drops a leading assistant message to avoid starting mid-turn', () => {
    const messages = [
      { role: 'assistant', content: 'a', timestamp: 1 },
      { role: 'user', content: 'b', timestamp: 2 },
      { role: 'assistant', content: 'c', timestamp: 3 },
    ] as any[];

    const ctx = buildSessionConversationContext(messages as any, {
      budgetTokens: 10,
      countTokens: () => 1,
    });

    expect(ctx[0]).toEqual({ role: 'user', content: 'b' });
  });

  it('truncates an oversized last message when nothing fits', () => {
    const messages = [{ role: 'user', content: 'x'.repeat(1000), timestamp: 1 }] as any[];

    const ctx = buildSessionConversationContext(messages as any, {
      budgetTokens: 10,
      countTokens: () => 9999,
    });

    expect(ctx).toHaveLength(1);
    expect(ctx[0].role).toBe('user');
    expect(ctx[0].content.length).toBe(40);
  });

  it('prepends structured summary state and human summary when provided', () => {
    const messages = [{ role: 'user', content: 'hello', timestamp: 1 }] as any[];

    const ctx = buildSessionConversationContext(messages as any, {
      budgetTokens: 200,
      countTokens: () => 1,
      summaryState: {
        summary: 'human summary',
        summaryTokens: 10,
        summarizedMessageIds: ['m1'],
        lastSummarizedAt: Date.now(),
        summaryVersion: 2,
        contextHash: 'ctx-abc',
        structuredState: {
          decisions: ['d1'],
          constraints: ['c1'],
          open_questions: [],
          pending_tasks: [],
          rejected_options: [],
          assumptions: [],
          risks: [],
          owner: ['agent'],
        },
      },
    });

    expect(ctx[0]?.role).toBe('system');
    expect(ctx[0]?.content).toContain('Conversation structured state');
    expect(ctx[0]?.content).toContain('contextHash=ctx-abc');
    expect(ctx[1]?.role).toBe('system');
    expect(ctx[1]?.content).toContain('human summary');
    expect(ctx[2]?.role).toBe('user');
  });
});
