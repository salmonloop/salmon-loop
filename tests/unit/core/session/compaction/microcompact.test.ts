import { beforeEach, describe, expect, it } from 'bun:test';
import { microcompact } from '../../../../../src/core/session/compaction/microcompact.js';
import type { ChatMessage } from '../../../../../src/core/session/types.js';
import { DEFAULT_MICROCOMPACT_CONFIG } from '../../../../../src/core/session/compaction/types.js';
import { setLogger, createLogger } from '../../../../../src/core/observability/logger.js';

describe('microcompact', () => {
  beforeEach(() => {
    setLogger(createLogger({ silent: true }));
  });

  const mockMessages: ChatMessage[] = [
    { role: 'user', content: 'hello', timestamp: 100 },
    {
      role: 'assistant',
      content: 'I will list files.\n<tool_result name="ls">file1.txt\nfile2.txt</tool_result>',
      timestamp: 200
    },
    { role: 'user', content: 'next', timestamp: 300 },
    {
      role: 'assistant',
      content: 'I will change dir.\n<tool_result name="cd">success</tool_result>',
      timestamp: 400
    },
    { role: 'user', content: 'last', timestamp: 500 },
    {
      role: 'assistant',
      content: 'I will list again.\n<tool_result name="ls">file3.txt</tool_result>',
      timestamp: 600
    },
  ];

  it('should clear old tool results but keep recent ones', () => {
    // keepRecentTurns: 1 means only the LAST assistant message is kept untouched
    const result = microcompact(mockMessages, { keepRecentTurns: 1 });

    // Last assistant message (index 5) should be untouched
    expect(result[5].content).toContain('file3.txt');

    // Older assistant message with non-stateful tool (index 1) should be cleared
    expect(result[1].content).toContain(DEFAULT_MICROCOMPACT_CONFIG.placeholder);
    expect(result[1].content).toContain('<tool_result name="ls">');

    // Assistant message with stateful tool (index 3) should be preserved
    expect(result[3].content).toContain('success');
  });

  it('should preserve assistant thoughts before tool results', () => {
    const result = microcompact(mockMessages, { keepRecentTurns: 0 });
    expect(result[1].content).toContain('I will list files.');
    expect(result[1].content).toContain(DEFAULT_MICROCOMPACT_CONFIG.placeholder);
  });

  it('should be idempotent', () => {
    const firstPass = microcompact(mockMessages, { keepRecentTurns: 0 });
    const secondPass = microcompact(firstPass, { keepRecentTurns: 0 });
    expect(firstPass).toEqual(secondPass);
  });

  it('should handle messages without tool results gracefully', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi', timestamp: 100 },
      { role: 'assistant', content: 'just text', timestamp: 200 },
    ];
    const result = microcompact(messages, { keepRecentTurns: 0 });
    expect(result).toEqual(messages);
  });

  it('should handle tool_result with extra attributes or spaces', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Extra attributes: <tool_result id="123" name="ls" status="success">file.txt</tool_result>',
        timestamp: 100
      },
      {
        role: 'assistant',
        content: 'Extra spaces: <tool_result   name="ls"  >file2.txt</tool_result>',
        timestamp: 200
      }
    ];

    const result = microcompact(messages, { keepRecentTurns: 0 });

    expect(result[0].content).toContain('<tool_result id="123" name="ls" status="success">');
    expect(result[0].content).toContain(DEFAULT_MICROCOMPACT_CONFIG.placeholder);

    expect(result[1].content).toContain('<tool_result   name="ls"  >');
    expect(result[1].content).toContain(DEFAULT_MICROCOMPACT_CONFIG.placeholder);
  });

  it('should handle multiple tool results in one message', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: `
          First: <tool_result name="ls">output1</tool_result>
          Second: <tool_result name="cd">success</tool_result>
          Third: <tool_result name="grep">output2</tool_result>
        `,
        timestamp: 100
      }
    ];

    const result = microcompact(messages, { keepRecentTurns: 0 });

    // ls and grep should be cleared
    expect(result[0].content).toContain('<tool_result name="ls">' + DEFAULT_MICROCOMPACT_CONFIG.placeholder + '</tool_result>');
    expect(result[0].content).toContain('<tool_result name="grep">' + DEFAULT_MICROCOMPACT_CONFIG.placeholder + '</tool_result>');

    // cd should NOT be cleared (stateful)
    expect(result[0].content).toContain('<tool_result name="cd">success</tool_result>');
  });
});
