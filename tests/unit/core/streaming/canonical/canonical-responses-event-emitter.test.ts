import { describe, expect, it } from 'vitest';

import { CanonicalResponsesEventEmitter } from '../../../../../src/core/streaming/canonical/canonical-responses-event-emitter.js';

describe('CanonicalResponsesEventEmitter', () => {
  it('emits implicit message + text part on first delta', () => {
    const emitter = new CanonicalResponsesEventEmitter();

    const events = emitter.push({ type: 'output_text.delta', streamId: 's1', delta: 'Hi' });
    expect(events).toEqual([
      {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'response.content_part.added',
        part: { type: 'output_text', text: '', annotations: [] },
      },
      {
        type: 'response.output_text.delta',
        delta: 'Hi',
        output_index: undefined,
        item_id: undefined,
        content_index: undefined,
        logprobs: undefined,
      },
    ]);
  });

  it('finish() closes open text streams', () => {
    const emitter = new CanonicalResponsesEventEmitter();

    emitter.push({ type: 'output_text.delta', streamId: 's1', delta: 'Hello' });
    const events = emitter.finish('s1');

    expect(events).toEqual([
      {
        type: 'response.output_text.done',
        output_index: undefined,
        item_id: undefined,
        content_index: undefined,
        text: 'Hello',
        logprobs: [],
      },
      {
        type: 'response.content_part.done',
        part: { type: 'output_text', text: 'Hello', annotations: [] },
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
        },
      },
    ]);
  });

  it('buffers function call args until the tool name is known', () => {
    const emitter = new CanonicalResponsesEventEmitter();

    const e1 = emitter.push({
      type: 'function_call_arguments.delta',
      streamId: 's1',
      callId: 'call-1',
      delta: '{"path":"x"}',
    });
    expect(e1).toEqual([]);

    const e2 = emitter.push({
      type: 'function_call.start',
      streamId: 's1',
      callId: 'call-1',
      name: 'fs.readFile',
    });
    expect(e2).toEqual([
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: undefined,
        item_id: 'function_call:call-1',
        delta: '{}',
      },
    ]);
  });

  it('emits redacted args delta+done and closes function calls on finish()', () => {
    const emitter = new CanonicalResponsesEventEmitter();

    const e1 = emitter.push({
      type: 'function_call.start',
      streamId: 's1',
      callId: 'call-1',
      name: 'fs.readFile',
    });
    const e2 = emitter.push({
      type: 'function_call_arguments.done',
      streamId: 's1',
      callId: 'call-1',
      name: 'fs.readFile',
      arguments: '{"path":"/secret"}',
    });
    const e3 = emitter.finish('s1');

    expect([...e1, ...e2, ...e3]).toEqual([
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: undefined,
        item_id: 'function_call:call-1',
        delta: '{}',
      },
      {
        type: 'response.function_call_arguments.done',
        output_index: undefined,
        item_id: 'function_call:call-1',
        name: 'fs.readFile',
        arguments: '{}',
      },
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{}',
          status: 'completed',
        },
      },
    ]);
  });
});
