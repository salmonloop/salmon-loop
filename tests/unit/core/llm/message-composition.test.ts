import { describe, expect, it } from 'bun:test';

import { composeChatMessages } from '../../../../src/core/llm/message-composition.js';

describe('composeChatMessages', () => {
  it('preserves summary system messages from conversationContext in order', () => {
    const messages = composeChatMessages({
      system: 'root system',
      user: 'current user',
      conversationContext: [
        { role: 'system', content: '[Previous conversation summary]\nSummary body' },
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' },
      ],
    });

    expect(messages).toEqual([
      { role: 'system', content: 'root system' },
      { role: 'system', content: '[Previous conversation summary]\nSummary body' },
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
      { role: 'user', content: 'current user' },
    ]);
  });

  it('filters tool messages and empty conversation entries', () => {
    const messages = composeChatMessages({
      system: 'root system',
      user: 'current user',
      conversationContext: [
        { role: 'tool', content: 'tool output', tool_call_id: 'call-1' },
        { role: 'system', content: 'summary kept   ' },
        { role: 'assistant', content: '   ' },
        { role: 'user', content: 'previous question' },
      ],
    });

    expect(messages).toEqual([
      { role: 'system', content: 'root system' },
      { role: 'system', content: 'summary kept' },
      { role: 'user', content: 'previous question' },
      { role: 'user', content: 'current user' },
    ]);
  });

  it('keeps previous behavior when no summary system messages are present', () => {
    const messages = composeChatMessages({
      system: 'root system',
      user: 'current user',
      conversationContext: [
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' },
      ],
    });

    expect(messages).toEqual([
      { role: 'system', content: 'root system' },
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
      { role: 'user', content: 'current user' },
    ]);
  });
});
