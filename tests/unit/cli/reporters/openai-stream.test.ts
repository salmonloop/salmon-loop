import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createStdoutWriter } from '../../../../src/cli/headless/stdout-writer.js';
import { OpenAiStreamReporter } from '../../../../src/cli/reporters/openai-stream.js';
import type { LoopResult } from '../../../../src/core/types/index.js';

function collectLines() {
  const lines: any[] = [];
  const write = (chunk: string) => {
    const trimmed = chunk.trimEnd();
    if (!trimmed) return true;
    for (const line of trimmed.split('\n')) lines.push(JSON.parse(line));
    return true;
  };
  return { lines, write };
}

describe('OpenAiStreamReporter', () => {
  it('matches golden fixture (basic)', () => {
    const fixtureUrl = new URL('../../../fixtures/headless/openai/basic.jsonl', import.meta.url);
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');
    reporter.onEvent({
      type: 'tool.call.start',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });
    reporter.onEvent({
      type: 'tool.call.end',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      status: 'ok',
      durationMs: 12,
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.stream.delta',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'Hello',
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.stream.end',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      finishReason: undefined,
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-basic)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-basic.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');
    const t0 = new Date('2026-02-20T00:00:01.000Z');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      timestamp: t0,
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.done',
        item_id: 'function_call:call-1',
        name: 'fs.readFile',
        arguments: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{}',
          status: 'completed',
        },
      },
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      timestamp: new Date('2026-02-20T00:00:05.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.added',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
      timestamp: new Date('2026-02-20T00:00:05.500Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.delta',
        delta: 'Hello',
      },
      timestamp: new Date('2026-02-20T00:00:06.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.done',
        text: 'Hello',
      },
      timestamp: new Date('2026-02-20T00:00:06.500Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.done',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: 'Hello' },
      },
      timestamp: new Date('2026-02-20T00:00:06.600Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      },
      timestamp: new Date('2026-02-20T00:00:06.700Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-two-tools)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-two-tools.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.done',
        item_id: 'function_call:call-1',
        name: 'fs.readFile',
        arguments: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{}',
          status: 'completed',
        },
      },
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-2',
          name: 'fs.writeFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      timestamp: new Date('2026-02-20T00:00:04.500Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-2',
        delta: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:05.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.done',
        item_id: 'function_call:call-2',
        name: 'fs.writeFile',
        arguments: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:05.500Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-2',
          name: 'fs.writeFile',
          arguments: '{}',
          status: 'completed',
        },
      },
      timestamp: new Date('2026-02-20T00:00:05.700Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      timestamp: new Date('2026-02-20T00:00:06.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.added',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
      timestamp: new Date('2026-02-20T00:00:06.100Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.delta',
        delta: 'Hi',
      },
      timestamp: new Date('2026-02-20T00:00:06.200Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.done',
        text: 'Hi',
      },
      timestamp: new Date('2026-02-20T00:00:06.300Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.done',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: 'Hi' },
      },
      timestamp: new Date('2026-02-20T00:00:06.400Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hi' }],
        },
      },
      timestamp: new Date('2026-02-20T00:00:06.500Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-two-messages)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-two-messages.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.added',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
      timestamp: new Date('2026-02-20T00:00:01.100Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: { type: 'response.output_text.delta', delta: 'A' },
      timestamp: new Date('2026-02-20T00:00:01.200Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: { type: 'response.output_text.done', text: 'A' },
      timestamp: new Date('2026-02-20T00:00:01.300Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.done',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: 'A' },
      },
      timestamp: new Date('2026-02-20T00:00:01.400Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'A' }],
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.500Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.content_part.added',
        item_id: 'stream-2',
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
      timestamp: new Date('2026-02-20T00:00:02.100Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: { type: 'response.output_text.delta', delta: 'B' },
      timestamp: new Date('2026-02-20T00:00:02.200Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: { type: 'response.output_text.done', text: 'B' },
      timestamp: new Date('2026-02-20T00:00:02.300Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.content_part.done',
        item_id: 'stream-2',
        content_index: 0,
        part: { type: 'output_text', text: 'B' },
      },
      timestamp: new Date('2026-02-20T00:00:02.400Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'B' }],
        },
      },
      timestamp: new Date('2026-02-20T00:00:02.500Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-failed)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-failed.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.added',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.delta',
        delta: 'Oops',
      },
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.done',
        text: 'Oops',
      },
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.done',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: 'Oops' },
      },
      timestamp: new Date('2026-02-20T00:00:05.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Oops' }],
        },
      },
      timestamp: new Date('2026-02-20T00:00:06.000Z'),
    });

    const result: LoopResult = {
      success: false,
      reason: 'Boom',
      reasonCode: 'LOOP_FAILED',
      errorCode: 'usage_error',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-tool-args-delta)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-tool-args-delta.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '{',
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '"a":1',
      },
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '}',
      },
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.done',
        item_id: 'function_call:call-1',
        name: 'fs.readFile',
        arguments: '{"a":1}',
      },
      timestamp: new Date('2026-02-20T00:00:05.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{"a":1}',
          status: 'completed',
        },
      },
      timestamp: new Date('2026-02-20T00:00:06.000Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-cancelled)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-cancelled.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.added',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.delta',
        delta: 'Bye',
      },
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_text.done',
        text: 'Bye',
      },
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.content_part.done',
        item_id: 'stream-1',
        content_index: 0,
        part: { type: 'output_text', text: 'Bye' },
      },
      timestamp: new Date('2026-02-20T00:00:05.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Bye' }],
        },
      },
      timestamp: new Date('2026-02-20T00:00:06.000Z'),
    });

    const result: LoopResult = {
      success: false,
      reason: 'Operation cancelled by user',
      reasonCode: 'LOOP_FAILED',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-interleaved-tool-args)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-interleaved-tool-args.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-2',
          name: 'fs.writeFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.100Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '{',
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-2',
        delta: '{',
      },
      timestamp: new Date('2026-02-20T00:00:02.100Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '"a":1',
      },
      timestamp: new Date('2026-02-20T00:00:02.200Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-2',
        delta: '"b":2',
      },
      timestamp: new Date('2026-02-20T00:00:02.300Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '}',
      },
      timestamp: new Date('2026-02-20T00:00:02.400Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-2',
        delta: '}',
      },
      timestamp: new Date('2026-02-20T00:00:02.500Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.done',
        item_id: 'function_call:call-1',
        name: 'fs.readFile',
        arguments: '{"a":1}',
      },
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{"a":1}',
          status: 'completed',
        },
      },
      timestamp: new Date('2026-02-20T00:00:03.100Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.done',
        item_id: 'function_call:call-2',
        name: 'fs.writeFile',
        arguments: '{"b":2}',
      },
      timestamp: new Date('2026-02-20T00:00:03.200Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call-2',
          name: 'fs.writeFile',
          arguments: '{"b":2}',
          status: 'completed',
        },
      },
      timestamp: new Date('2026-02-20T00:00:03.300Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (canonical-item-ids)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/canonical-item-ids.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:07.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: () => 'unused',
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '',
          status: 'in_progress',
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.delta',
        item_id: 'function_call:call-1',
        delta: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.function_call_arguments.done',
        item_id: 'function_call:call-1',
        name: 'fs.readFile',
        arguments: '{}',
      },
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{}',
          status: 'completed',
        },
      },
      timestamp: new Date('2026-02-20T00:00:04.000Z'),
    });

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_item.added',
        item: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      timestamp: new Date('2026-02-20T00:00:05.000Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.content_part.added',
        item_id: 'stream-2',
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
      timestamp: new Date('2026-02-20T00:00:05.100Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_text.delta',
        delta: 'Hello',
      },
      timestamp: new Date('2026-02-20T00:00:05.200Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_text.done',
        text: 'Hello',
      },
      timestamp: new Date('2026-02-20T00:00:05.300Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.content_part.done',
        item_id: 'stream-2',
        content_index: 0,
        part: { type: 'output_text', text: 'Hello' },
      },
      timestamp: new Date('2026-02-20T00:00:05.400Z'),
    });
    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-2',
      source: 'synthesized',
      event: {
        type: 'response.output_item.done',
        item: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      },
      timestamp: new Date('2026-02-20T00:00:05.500Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (error)', () => {
    const fixtureUrl = new URL('../../../fixtures/headless/openai/error.jsonl', import.meta.url);
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:02.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');
    reporter.onError(new Error('Boom'));

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (report-only)', () => {
    const fixtureUrl = new URL(
      '../../../fixtures/headless/openai/report-only.jsonl',
      import.meta.url,
    );
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const nowQueue = [new Date('2026-02-20T00:00:00.000Z'), new Date('2026-02-20T00:00:05.000Z')];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new OpenAiStreamReporter({
      model: 'gpt-test',
      now,
      responseId: () => 'resp_1',
      itemId: (() => {
        let i = 0;
        return () => `item-${++i}`;
      })(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');
    reporter.onEvent({
      type: 'llm.output',
      kind: 'assistant_message',
      step: 'REPORT',
      content: 'Hello world',
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });
});
