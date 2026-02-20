import { describe, expect, it, vi } from 'vitest';

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
      write,
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
      type: 'start',
      session_id: 'sess-1',
      command: 'run',
      repo_path: '/repo',
      instruction: 'do the thing',
      timestamp: '2026-02-20T00:00:00.000Z',
    });

    expect(lines[1]).toMatchObject({
      type: 'loop_event',
      session_id: 'sess-1',
      timestamp: '2026-02-20T00:00:01.000Z',
      event: { type: 'phase.start', phase: 'PLAN' },
    });

    expect(lines[2]).toMatchObject({
      type: 'stream_event',
      session_id: 'sess-1',
      timestamp: '2026-02-20T00:00:02.000Z',
    });
    expect(lines[2].event?.delta).toEqual({ type: 'text_delta', text: 'Hello' });

    expect(lines[3]).toMatchObject({
      type: 'loop_event',
      session_id: 'sess-1',
      timestamp: '2026-02-20T00:00:03.000Z',
      event: { type: 'llm.output', kind: 'assistant_message', step: 'REPORT', content: 'Done' },
    });

    expect(lines[4]).toMatchObject({
      type: 'result',
      session_id: 'sess-1',
      success: true,
      exit_code: 0,
      attempts: 1,
      changed_files: ['src/a.ts'],
      result: 'Done',
    });

    expect(lines[5]).toMatchObject({
      type: 'end',
      session_id: 'sess-1',
      success: true,
      exit_code: 0,
    });

    vi.useRealTimers();
  });

  it('uses exit code 130 for user cancellation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    const { lines, write } = collectLines();
    const reporter = new StreamJsonReporter({ sessionId: 'sess-2', now: () => new Date(), write });

    reporter.onStart('x');
    reporter.onFinish({
      success: false,
      reason: 'Operation cancelled by user',
      reasonCode: 'LOOP_FAILED',
      attempts: 1,
      logs: [],
    } as any);

    const resultLine = lines.find((l) => l.type === 'result');
    const endLine = lines.find((l) => l.type === 'end');
    expect(resultLine.exit_code).toBe(130);
    expect(endLine.exit_code).toBe(130);

    vi.useRealTimers();
  });
});
