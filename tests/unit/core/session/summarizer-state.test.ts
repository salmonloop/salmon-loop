import { describe, expect, it } from 'bun:test';

import { ConversationSummarizer } from '../../../../src/core/context/summarization/summarizer.js';
import { DEFAULT_SUMMARIZATION_CONFIG } from '../../../../src/core/context/summarization/types.js';

describe('ConversationSummarizer state snapshots', () => {
  it('returns deeply cloned structured state from getState', () => {
    const summarizer = new ConversationSummarizer(
      {
        chat: async () => ({ content: 'unused' }),
      },
      {
        count: () => 1,
      },
      {
        ...DEFAULT_SUMMARIZATION_CONFIG,
        async: false,
        summaryModel: {
          model: 'test-model',
          temperature: 0,
          maxTokens: 32,
        },
      },
    );

    summarizer.restoreState({
      summary: 'summary',
      summaryTokens: 3,
      summarizedMessageIds: ['m-1'],
      lastSummarizedAt: 100,
      summaryVersion: 2,
      contextHash: 'ctx-1',
      structuredState: {
        decisions: ['d1'],
        constraints: ['c1'],
        open_questions: [],
        pending_tasks: [],
        rejected_options: [],
        assumptions: [],
        risks: [],
        owner: [],
      },
    });

    const snapshot = summarizer.getState();
    snapshot.summarizedMessageIds.push('m-2');
    snapshot.structuredState?.decisions.push('mutated');

    const next = summarizer.getState();
    expect(next.summarizedMessageIds).toEqual(['m-1']);
    expect(next.structuredState?.decisions).toEqual(['d1']);
    expect(next.structuredState?.constraints).toEqual(['c1']);
  });
});
