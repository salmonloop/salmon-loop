import { describe, expect, it } from 'vitest';

import { createAssistantTextMessageEvents } from '../../../../src/core/streaming/normalized-from-text.js';

describe('createAssistantTextMessageEvents', () => {
  it('creates a minimal assistant text message sequence', () => {
    const at = new Date('2026-02-20T00:00:03.000Z');
    const out = createAssistantTextMessageEvents({
      messageId: 'msg-1',
      text: 'Hello world',
      timestamp: at,
    });

    expect(out).toEqual([
      {
        type: 'normalized.message_start',
        messageId: 'msg-1',
        role: 'assistant',
        source: 'llm',
        timestamp: at,
      },
      {
        type: 'normalized.content_block_start',
        messageId: 'msg-1',
        blockId: 'msg-1:text:0',
        blockType: 'text',
        index: 0,
        timestamp: at,
      },
      {
        type: 'normalized.content_block_delta',
        messageId: 'msg-1',
        blockId: 'msg-1:text:0',
        index: 0,
        deltaType: 'text',
        text: 'Hello world',
        timestamp: at,
      },
      {
        type: 'normalized.content_block_end',
        messageId: 'msg-1',
        blockId: 'msg-1:text:0',
        index: 0,
        timestamp: at,
      },
      {
        type: 'normalized.message_end',
        messageId: 'msg-1',
        stopReason: 'end_turn',
        finishReason: undefined,
        timestamp: at,
      },
    ]);
  });
});
