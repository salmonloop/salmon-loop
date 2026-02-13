import { emitLlmStreamDelta, sanitizeLlmOutput } from '../../../src/core/llm/output-policy.js';
import type { LoopEvent } from '../../../src/core/types/index.js';
import type { LlmOutputPolicy } from '../../../src/core/types/index.js';

describe('llm output policy', () => {
  it('redacts assignment-style secret lines', () => {
    const content = 'api_key: sk-1234567890abcdef\nsafe line';
    const sanitized = sanitizeLlmOutput(content);

    expect(sanitized).toContain('api_key: [REDACTED]');
    expect(sanitized).not.toContain('sk-1234567890abcdef');
    expect(sanitized).toContain('safe line');
  });

  it('does not leak secrets when split across stream deltas', () => {
    const events: LoopEvent[] = [];
    const emit = (event: LoopEvent) => events.push(event);
    const policy: LlmOutputPolicy = { kinds: ['plan'] };

    emitLlmStreamDelta({
      emit,
      policy,
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'api_key',
    });
    emitLlmStreamDelta({
      emit,
      policy,
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: ': sk-1234567890abcdef\n',
    });

    const streamed = events
      .filter((event) => event.type === 'llm.stream.delta')
      .map((event) => (event.type === 'llm.stream.delta' ? event.content : ''))
      .join('');

    expect(streamed).toContain('api_key: [REDACTED]');
    expect(streamed).not.toContain('sk-1234567890abcdef');
  });
});
