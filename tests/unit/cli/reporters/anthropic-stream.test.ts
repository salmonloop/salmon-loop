import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { AnthropicStreamReporter } from '../../../../src/cli/reporters/anthropic-stream.js';
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

describe('AnthropicStreamReporter', () => {
  it('emits start, stream_event lines, result, and end', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    const { lines, write } = collectLines();

    const reporter = new AnthropicStreamReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-1',
      write,
    });

    reporter.onStart('do the thing');

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
      type: 'start',
      session_id: 'sess-1',
      command: 'run',
      repo_path: '/repo',
      instruction: 'do the thing',
    });

    expect(lines[1]).toMatchObject({
      type: 'stream_event',
      session_id: 'sess-1',
      event: { type: 'message_start' },
    });

    expect(lines[2]).toMatchObject({
      type: 'stream_event',
      session_id: 'sess-1',
      event: { type: 'content_block_start' },
    });

    expect(lines[3]).toMatchObject({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      },
    });

    const resultLine = lines.find((l) => l.type === 'result');
    const endLine = lines.find((l) => l.type === 'end');
    expect(resultLine).toMatchObject({
      type: 'result',
      session_id: 'sess-1',
      success: true,
      exit_code: 0,
      result: 'Done',
    });
    expect(endLine).toMatchObject({
      type: 'end',
      session_id: 'sess-1',
      success: true,
      exit_code: 0,
    });

    vi.useRealTimers();
  });

  it('emits tool_use and tool_result blocks for tool calls', () => {
    const { lines, write } = collectLines();

    const reporter = new AnthropicStreamReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-tool',
      write,
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

    const toolUse = lines.find(
      (l) =>
        l.type === 'stream_event' &&
        l.parent_tool_use_id === 'call-1' &&
        l.event?.type === 'content_block_start' &&
        l.event?.content_block?.type === 'tool_use',
    );
    expect(toolUse).toMatchObject({
      type: 'stream_event',
      session_id: 'sess-tool',
      parent_tool_use_id: 'call-1',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'call-1', name: 'fs.readFile', input: {} },
      },
    });

    const toolResult = lines.find(
      (l) =>
        l.type === 'stream_event' &&
        l.parent_tool_use_id === 'call-1' &&
        l.event?.type === 'content_block_start' &&
        l.event?.content_block?.type === 'tool_result',
    );
    expect(toolResult).toMatchObject({
      type: 'stream_event',
      session_id: 'sess-tool',
      parent_tool_use_id: 'call-1',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_result', tool_use_id: 'call-1', is_error: false },
      },
    });
  });

  it('matches golden fixture', () => {
    const fixtureUrl = new URL('../../../fixtures/headless/anthropic/basic.jsonl', import.meta.url);
    const expected = readFileSync(fixtureUrl, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const { lines, write } = collectLines();
    const reporter = new AnthropicStreamReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-golden',
      write,
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
      changedFiles: [],
    };
    reporter.onFinish(result);

    expect(lines).toEqual(expected);
  });
});
