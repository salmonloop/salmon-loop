import { describe, expect, it } from 'vitest';

import { StreamAssembler } from '../../../../src/core/streaming/stream-assembler.js';
import type { LoopEvent } from '../../../../src/core/types/index.js';

describe('StreamAssembler', () => {
  it('emits a text prelude on first delta, then delta', () => {
    const assembler = new StreamAssembler();
    const at = new Date('2026-02-20T00:00:02.000Z');

    const out = assembler.push({
      type: 'llm.stream.delta',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'Hello',
      timestamp: at,
    } satisfies LoopEvent);

    expect(out).toEqual([
      {
        type: 'normalized.message_start',
        messageId: 'stream-1',
        role: 'assistant',
        source: 'llm',
        timestamp: at,
      },
      {
        type: 'normalized.content_block_start',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        blockType: 'text',
        index: 0,
        timestamp: at,
      },
      {
        type: 'normalized.content_block_delta',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        index: 0,
        deltaType: 'text',
        text: 'Hello',
        timestamp: at,
      },
    ]);
  });

  it('emits a text prelude on response output_text delta, then delta', () => {
    const assembler = new StreamAssembler();
    const at = new Date('2026-02-20T00:00:02.000Z');

    const out = assembler.push({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'provider',
      event: {
        type: 'response.output_text.delta',
        delta: 'Hello',
      },
      timestamp: at,
    } as unknown as LoopEvent);

    expect(out).toEqual([
      {
        type: 'normalized.message_start',
        messageId: 'stream-1',
        role: 'assistant',
        source: 'llm',
        timestamp: at,
      },
      {
        type: 'normalized.content_block_start',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        blockType: 'text',
        index: 0,
        timestamp: at,
      },
      {
        type: 'normalized.content_block_delta',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        index: 0,
        deltaType: 'text',
        text: 'Hello',
        timestamp: at,
      },
    ]);
  });

  it('ignores legacy text deltas when canonical text deltas are present', () => {
    const assembler = new StreamAssembler();
    const at = new Date('2026-02-20T00:00:02.000Z');

    const canonical = assembler.push({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.delta',
        delta: 'Hello',
      },
      timestamp: at,
    } satisfies LoopEvent);

    const legacy = assembler.push({
      type: 'llm.stream.delta',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'Hello',
      timestamp: at,
    } satisfies LoopEvent);

    expect(canonical).toHaveLength(3);
    expect(legacy).toEqual([]);
  });

  it('emits only delta for subsequent deltas on the same stream', () => {
    const assembler = new StreamAssembler();
    const at1 = new Date('2026-02-20T00:00:02.000Z');
    const at2 = new Date('2026-02-20T00:00:03.000Z');

    assembler.push({
      type: 'llm.stream.delta',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'A',
      timestamp: at1,
    } satisfies LoopEvent);

    const out2 = assembler.push({
      type: 'llm.stream.delta',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'B',
      timestamp: at2,
    } satisfies LoopEvent);

    expect(out2).toEqual([
      {
        type: 'normalized.content_block_delta',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        index: 0,
        deltaType: 'text',
        text: 'B',
        timestamp: at2,
      },
    ]);
  });

  it('emits block end and message end on response output_text done (defaults to end_turn)', () => {
    const assembler = new StreamAssembler();
    const at1 = new Date('2026-02-20T00:00:02.000Z');
    const at2 = new Date('2026-02-20T00:00:04.000Z');

    assembler.push({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'provider',
      event: {
        type: 'response.output_text.delta',
        delta: 'Hello',
      },
      timestamp: at1,
    } as unknown as LoopEvent);

    const out = assembler.push({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'provider',
      event: {
        type: 'response.output_text.done',
      },
      timestamp: at2,
    } as unknown as LoopEvent);

    expect(out).toEqual([
      {
        type: 'normalized.content_block_end',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        index: 0,
        timestamp: at2,
      },
      {
        type: 'normalized.message_end',
        messageId: 'stream-1',
        stopReason: 'end_turn',
        finishReason: undefined,
        timestamp: at2,
      },
    ]);
  });

  it('emits block end and message end on stream end (defaults to end_turn)', () => {
    const assembler = new StreamAssembler();
    const at1 = new Date('2026-02-20T00:00:02.000Z');
    const at2 = new Date('2026-02-20T00:00:04.000Z');

    assembler.push({
      type: 'llm.stream.delta',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'Hello',
      timestamp: at1,
    } satisfies LoopEvent);

    const out = assembler.push({
      type: 'llm.stream.end',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      finishReason: undefined,
      timestamp: at2,
    } satisfies LoopEvent);

    expect(out).toEqual([
      {
        type: 'normalized.content_block_end',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        index: 0,
        timestamp: at2,
      },
      {
        type: 'normalized.message_end',
        messageId: 'stream-1',
        stopReason: 'end_turn',
        finishReason: undefined,
        timestamp: at2,
      },
    ]);
  });

  it('emits a prelude even if stream end arrives without any delta', () => {
    const assembler = new StreamAssembler();
    const at = new Date('2026-02-20T00:00:04.000Z');

    const out = assembler.push({
      type: 'llm.stream.end',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      finishReason: 'tool_use',
      timestamp: at,
    } satisfies LoopEvent);

    expect(out).toEqual([
      {
        type: 'normalized.message_start',
        messageId: 'stream-1',
        role: 'assistant',
        source: 'llm',
        timestamp: at,
      },
      {
        type: 'normalized.content_block_start',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        blockType: 'text',
        index: 0,
        timestamp: at,
      },
      {
        type: 'normalized.content_block_end',
        messageId: 'stream-1',
        blockId: 'stream-1:text:0',
        index: 0,
        timestamp: at,
      },
      {
        type: 'normalized.message_end',
        messageId: 'stream-1',
        stopReason: 'tool_use',
        finishReason: 'tool_use',
        timestamp: at,
      },
    ]);
  });

  it('emits tool call events without tool payload', () => {
    const assembler = new StreamAssembler();
    const at1 = new Date('2026-02-20T00:00:01.000Z');
    const at2 = new Date('2026-02-20T00:00:02.000Z');

    const start = assembler.push({
      type: 'tool.call.start',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      timestamp: at1,
    } satisfies LoopEvent);

    expect(start).toEqual([
      {
        type: 'normalized.tool_call_start',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        timestamp: at1,
      },
    ]);

    const end = assembler.push({
      type: 'tool.call.end',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      status: 'ok',
      durationMs: 12,
      timestamp: at2,
    } satisfies LoopEvent);

    expect(end).toEqual([
      {
        type: 'normalized.tool_call_end',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        status: 'ok',
        durationMs: 12,
        errorCode: undefined,
        timestamp: at2,
      },
    ]);
  });

  it('emits model tool call start from canonical output_item.added and suppresses host start', () => {
    const assembler = new StreamAssembler();
    const at1 = new Date('2026-02-20T00:00:01.000Z');
    const at2 = new Date('2026-02-20T00:00:02.000Z');
    const at3 = new Date('2026-02-20T00:00:03.000Z');

    const modelStart = assembler.push({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'provider',
      phase: 'PATCH',
      round: 1,
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{}',
        },
      },
      timestamp: at1,
    } satisfies LoopEvent);

    expect(modelStart).toEqual([
      {
        type: 'normalized.tool_request_start',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        timestamp: at1,
      },
      {
        type: 'normalized.tool_call_start',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        input: undefined,
        timestamp: at1,
      },
    ]);

    const modelDone = assembler.push({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'provider',
      phase: 'PATCH',
      round: 1,
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{}',
        },
      },
      timestamp: at2,
    } satisfies LoopEvent);

    expect(modelDone).toEqual([
      {
        type: 'normalized.tool_request_end',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        timestamp: at2,
      },
    ]);

    const hostStart = assembler.push({
      type: 'tool.call.start',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      timestamp: at3,
    } satisfies LoopEvent);

    expect(hostStart).toEqual([]);

    const hostEnd = assembler.push({
      type: 'tool.call.end',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      status: 'ok',
      durationMs: 12,
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    } satisfies LoopEvent);

    expect(hostEnd).toEqual([
      {
        type: 'normalized.tool_call_end',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        status: 'ok',
        durationMs: 12,
        errorCode: undefined,
        timestamp: new Date('2026-02-20T00:00:04.000Z'),
      },
    ]);
  });

  it('passes through optional tool payload fields', () => {
    const assembler = new StreamAssembler();
    const at1 = new Date('2026-02-20T00:00:01.000Z');
    const at2 = new Date('2026-02-20T00:00:02.000Z');

    const start = assembler.push({
      type: 'tool.call.start',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      input: { file: 'README.md' },
      timestamp: at1,
    } satisfies LoopEvent);

    expect(start).toEqual([
      {
        type: 'normalized.tool_call_start',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        input: { file: 'README.md' },
        timestamp: at1,
      },
    ]);

    const end = assembler.push({
      type: 'tool.call.end',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      status: 'ok',
      outputSummary: '{"ok":true}',
      timestamp: at2,
    } satisfies LoopEvent);

    expect(end).toEqual([
      {
        type: 'normalized.tool_call_end',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        round: 1,
        status: 'ok',
        durationMs: undefined,
        errorCode: undefined,
        outputSummary: '{"ok":true}',
        timestamp: at2,
      },
    ]);
  });
});
