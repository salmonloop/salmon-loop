import { describe, expect, it } from 'vitest';

import { buildTranscriptMessages } from '../../../../src/cli/ui/utils/transcript.js';

describe('buildTranscriptMessages', () => {
  it('maps user/assistant messages and skips others', () => {
    const out = buildTranscriptMessages(
      [
        { role: 'system', content: 'ignored', timestamp: 1 },
        { role: 'user', content: 'hello', timestamp: 2 },
        { role: 'assistant', content: 'world', timestamp: 3 },
        { role: 'tool', content: 'ignored', timestamp: 4 },
      ] as any,
      { limit: 200 },
    );

    expect(out).toEqual([
      { id: 'transcript-user-2-0', type: 'user', content: 'hello', timestamp: new Date(2) },
      {
        id: 'transcript-assistant-3-1',
        type: 'assistant',
        content: 'world',
        timestamp: new Date(3),
      },
    ]);
  });

  it('keeps only the most recent messages within limit', () => {
    const out = buildTranscriptMessages(
      [
        { role: 'user', content: 'a', timestamp: 1 },
        { role: 'assistant', content: 'b', timestamp: 2 },
        { role: 'user', content: 'c', timestamp: 3 },
      ] as any,
      { limit: 2 },
    );

    expect(out.map((m) => m.content)).toEqual(['b', 'c']);
  });
});
