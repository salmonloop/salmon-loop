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
      itemId: () => 'msg_1',
      functionCallId: () => 'fc_1',
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
      itemId: () => 'msg_1',
      functionCallId: () => 'fc_1',
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');
    reporter.onError(new Error('Boom'));

    expect(lines).toEqual(expected);
  });
});
