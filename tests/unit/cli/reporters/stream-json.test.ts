import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createStdoutWriter } from '../../../../src/cli/headless/stdout-writer.js';
import { StreamJsonReporter } from '../../../../src/cli/reporters/stream-json.js';
import type { LoopEvent, LoopResult } from '../../../../src/core/types/index.js';

function collectLines() {
  const lines: any[] = [];
  const write = (chunk: string) => {
    const trimmed = chunk.trimEnd();
    if (!trimmed) return true;
    for (const line of trimmed.split('\n')) {
      lines.push(JSON.parse(line));
    }
    return true;
  };
  return { lines, write };
}

describe('StreamJsonReporter', () => {
  it('emits JSONL with start, events, result, and end', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    const { lines, write } = collectLines();

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-1',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    const phaseStart: LoopEvent = {
      type: 'phase.start',
      phase: 'PLAN',
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    };
    reporter.onEvent(phaseStart);

    const delta: LoopEvent = {
      type: 'llm.stream.delta',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      content: 'Hello',
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    };
    reporter.onEvent(delta);

    const assistantMessage: LoopEvent = {
      type: 'llm.output',
      kind: 'assistant_message',
      step: 'REPORT',
      content: 'Done',
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    };
    reporter.onEvent(assistantMessage);

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: ['src/a.ts'],
    };
    reporter.onFinish(result);

    expect(lines[0]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: {
        type: 'start',
        command: 'run',
        repo_path: '/repo',
        instruction: 'do the thing',
        timestamp: '2026-02-20T00:00:00.000Z',
      },
    });

    expect(lines[1]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: { type: 'phase.start', phase: 'PLAN', timestamp: '2026-02-20T00:00:01.000Z' },
    });

    expect(lines[2]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: { type: 'message_start', timestamp: '2026-02-20T00:00:02.000Z' },
    });

    expect(lines[3]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: { type: 'content_block_start', timestamp: '2026-02-20T00:00:02.000Z' },
    });

    expect(lines[4]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        timestamp: '2026-02-20T00:00:02.000Z',
        delta: { type: 'text_delta', text: 'Hello' },
      },
    });

    expect(lines[5]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: {
        type: 'llm.output',
        kind: 'assistant_message',
        step: 'REPORT',
        content: 'Done',
        timestamp: '2026-02-20T00:00:03.000Z',
      },
    });

    expect(lines[6]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: {
        type: 'result',
        success: true,
        exit_code: 0,
        attempts: 1,
        changed_files: ['src/a.ts'],
        result: 'Done',
      },
    });

    expect(lines[7]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      event: {
        type: 'end',
        success: true,
        exit_code: 0,
      },
    });

    vi.useRealTimers();
  });

  it('emits tool_use and tool_result blocks for tool calls', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    const { lines, write } = collectLines();

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-tool',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('x');

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

    const toolUseStart = lines.find((l) => l.event?.type === 'content_block_start') as any;
    expect(toolUseStart).toMatchObject({
      session_id: 'sess-tool',
      parent_tool_use_id: 'call-1',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'call-1',
          name: 'fs.readFile',
          input: {},
        },
      },
    });

    const toolResultStart = lines.find(
      (l) =>
        l.parent_tool_use_id === 'call-1' &&
        l.event?.type === 'content_block_start' &&
        l.event?.content_block?.type === 'tool_result',
    ) as any;

    expect(toolResultStart).toMatchObject({
      session_id: 'sess-tool',
      parent_tool_use_id: 'call-1',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'tool_result',
          tool_use_id: 'call-1',
          is_error: false,
        },
      },
    });

    vi.useRealTimers();
  });

  it('matches golden fixture (basic)', () => {
    const fixtureUrl = new URL('../../../fixtures/headless/native/basic.jsonl', import.meta.url);
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();

    let uuidCounter = 0;
    const nowQueue = [
      new Date('2026-02-20T00:00:00.000Z'),
      new Date('2026-02-20T00:00:06.000Z'),
      new Date('2026-02-20T00:00:07.000Z'),
    ];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-golden',
      now,
      uuid: () => `uuid-${++uuidCounter}`,
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
    reporter.onEvent({
      type: 'llm.output',
      kind: 'assistant_message',
      step: 'REPORT',
      content: 'Done',
      timestamp: new Date('2026-02-20T00:00:05.000Z'),
    });

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: ['src/a.ts'],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });

  it('matches golden fixture (error)', () => {
    const fixtureUrl = new URL('../../../fixtures/headless/native/error.jsonl', import.meta.url);
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();

    let uuidCounter = 0;
    const nowQueue = [
      new Date('2026-02-20T00:00:00.000Z'),
      new Date('2026-02-20T00:00:01.000Z'),
      new Date('2026-02-20T00:00:02.000Z'),
    ];
    const now = () => {
      const next = nowQueue.shift();
      if (!next) throw new Error('now() called too many times');
      return next;
    };

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-error',
      now,
      uuid: () => `uuid-${++uuidCounter}`,
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    const err = new Error('Boom');
    err.stack = 'STACK';
    reporter.onError(err);

    expect(lines).toEqual(expected);
  });

  it('uses exit code 130 for user cancellation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    const { lines, write } = collectLines();
    const reporter = new StreamJsonReporter({
      sessionId: 'sess-2',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('x');
    reporter.onFinish({
      success: false,
      reason: 'Operation cancelled by user',
      reasonCode: 'LOOP_FAILED',
      attempts: 1,
      logs: [],
    } as any);

    const resultLine = lines.find((l) => l.event?.type === 'result');
    const endLine = lines.find((l) => l.event?.type === 'end');
    expect(resultLine.event.exit_code).toBe(130);
    expect(endLine.event.exit_code).toBe(130);

    vi.useRealTimers();
  });
});
