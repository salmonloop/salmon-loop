import { describe, expect, it } from 'bun:test';

import { mapLlmStreamChunkToCanonicalStreamParts } from '../../../../../src/core/streaming/canonical/parts-from-llm-stream-chunk.js';

describe('mapLlmStreamChunkToCanonicalStreamParts', () => {
  it('maps content deltas to output_text.delta parts', () => {
    const parts = mapLlmStreamChunkToCanonicalStreamParts({
      streamId: 's1',
      chunk: { role: 'assistant', contentDelta: 'Hi' },
    });

    expect(parts).toEqual([{ type: 'output_text.delta', streamId: 's1', delta: 'Hi' }]);
  });

  it('maps OpenAI-like tool_calls to function_call parts', () => {
    const parts = mapLlmStreamChunkToCanonicalStreamParts({
      streamId: 's1',
      chunk: {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'fs.readFile', arguments: '{"path":"README.md"}' },
          },
        ],
      },
    });

    expect(parts).toEqual([
      { type: 'function_call.start', streamId: 's1', callId: 'call-1', name: 'fs.readFile' },
      {
        type: 'function_call_arguments.done',
        streamId: 's1',
        callId: 'call-1',
        name: 'fs.readFile',
        arguments: '{"path":"README.md"}',
      },
    ]);
  });

  it('ignores tool calls without a name', () => {
    const parts = mapLlmStreamChunkToCanonicalStreamParts({
      streamId: 's1',
      chunk: {
        role: 'assistant',
        tool_calls: [{ id: 'call-1', type: 'function', function: { arguments: '{}' } }],
      } as any,
    });

    expect(parts).toEqual([]);
  });
});
