import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';

import { createStdoutWriter } from '../../../../src/cli/headless/stdout-writer.js';
import { StreamJsonReporter } from '../../../../src/cli/reporters/stream-json.js';
import type { LoopEvent, LoopResult } from '../../../../src/core/types/index.js';
import { freezeSystemTime } from '../../../helpers/time.js';

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
  it('emits authorization decision events as loop events', () => {
    const { lines, write } = collectLines();

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-authz',
      now: () => new Date('2026-02-20T00:00:00.000Z'),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('x');
    reporter.onEvent({
      type: 'authorization.decision',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      outcome: 'allow_once',
      source: 'user',
      reason: 'ok',
      ttlMs: 123,
      persist: 'repo',
      riskLevel: 'low',
      sideEffects: ['read'],
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });

    const decisionLine = lines.find((l) => l.event?.type === 'authorization.decision');
    expect(decisionLine).toMatchObject({
      session_id: 'sess-authz',
      event: {
        type: 'authorization.decision',
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        outcome: 'allow_once',
        source: 'user',
        reason: 'ok',
        ttlMs: 123,
        persist: 'repo',
        riskLevel: 'low',
        sideEffects: ['read'],
      },
    });
  });

  it('emits JSONL with start, events, result, and end', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

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
      benchmarkPatchArtifact: {
        kind: 'git-unified-diff',
        path: '/tmp/patch.diff',
        sha256: 'b'.repeat(64),
        bytes: 42,
        changedFiles: ['src/a.ts'],
        isEmpty: false,
      },
      benchmarkArtifact: {
        provider: 'swe-bench',
        instanceId: 'repo__project-1',
        modelNameOrPath: 'salmon-loop',
        predictionsPath: '/tmp/predictions.jsonl',
      },
    };
    reporter.onFinish(result);

    expect(lines[0]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      protocol_version: 1,
      event_seq: 0,
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
      protocol_version: 1,
      event_seq: 1,
      event: { type: 'phase.start', phase: 'PLAN', timestamp: '2026-02-20T00:00:01.000Z' },
    });

    expect(lines[2]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      protocol_version: 1,
      event_seq: 2,
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
      protocol_version: 1,
      event_seq: 6,
      event: {
        type: 'result',
        success: true,
        exit_code: 0,
        attempts: 1,
        changed_files: ['src/a.ts'],
        patch_artifact: {
          kind: 'git-unified-diff',
          path: '/tmp/patch.diff',
          sha256: 'b'.repeat(64),
          bytes: 42,
          changed_files: ['src/a.ts'],
          is_empty: false,
        },
        benchmark_artifact: {
          provider: 'swe-bench',
          instance_id: 'repo__project-1',
          model_name_or_path: 'salmon-loop',
          predictions_path: '/tmp/predictions.jsonl',
        },
        result: 'Done',
        warnings: [],
        run_end: {
          success: true,
          exit_code: 0,
          timestamp: '2026-02-20T00:00:00.000Z',
        },
      },
    });

    expect(lines[7]).toMatchObject({
      uuid: expect.any(String),
      session_id: 'sess-1',
      protocol_version: 1,
      event_seq: 7,
      event: {
        type: 'end',
        success: true,
        exit_code: 0,
      },
    });
    expect(lines.map((line) => line.event_seq)).toEqual([...lines.keys()]);

    useRealTimers();
    restoreTime();
  });

  it('includes structured warnings on result events', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

    const { lines, write } = collectLines();
    const reporter = new StreamJsonReporter({
      sessionId: 'sess-warnings',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
      getWarnings: () => [
        {
          code: 'VERIFY_COMMAND_MISSING',
          message: 'No verification command found. Verification will be skipped.',
          source: 'verify.runtime',
          severity: 'warning',
        },
      ],
    });

    reporter.onStart('x');
    reporter.onFinish({
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: [],
    } as any);

    const resultLine = lines.find((line) => line.event?.type === 'result');
    expect(resultLine).toMatchObject({
      protocol_version: 1,
      event_seq: 1,
      event: {
        type: 'result',
        warnings: [
          {
            code: 'VERIFY_COMMAND_MISSING',
            message: 'No verification command found. Verification will be skipped.',
            source: 'verify.runtime',
            severity: 'warning',
          },
        ],
      },
    });

    useRealTimers();
    restoreTime();
  });

  it('keeps retry exhaustion reason separate from terminal failure guidance', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

    const { lines, write } = collectLines();
    const reporter = new StreamJsonReporter({
      mode: 'run',
      sessionId: 'sess-retry',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('x');
    reporter.onFinish({
      success: false,
      reason: 'Exceeded maximum retry attempts',
      reasonCode: 'MAX_RETRIES',
      diagnosticCode: 'VERIFY_FAILED',
      safeHint: 'Verification failed.',
      remediationSteps: ['Fix the failing verification and retry.'],
      attempts: 3,
      logs: [],
      changedFiles: ['data.txt'],
    } as any);

    const resultLine = lines.find((line) => line.event?.type === 'result');
    expect(resultLine).toMatchObject({
      event: {
        type: 'result',
        success: false,
        reason: 'Exceeded maximum retry attempts',
        reason_code: 'MAX_RETRIES',
        diagnostic_code: 'VERIFY_FAILED',
        safe_hint: 'Verification failed.',
        remediation_steps: ['Fix the failing verification and retry.'],
        changed_files: ['data.txt'],
      },
    });

    useRealTimers();
    restoreTime();
  });

  it('emits an empty changed_files list when LoopResult omits changedFiles', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

    const { lines, write } = collectLines();
    const reporter = new StreamJsonReporter({
      mode: 'run',
      sessionId: 'sess-empty',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('x');
    reporter.onFinish({
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
    });

    const resultLine = lines.find((line) => line.event?.type === 'result');
    expect(resultLine).toMatchObject({
      event: {
        type: 'result',
        changed_files: [],
      },
    });

    useRealTimers();
    restoreTime();
  });

  it('emits tool_use and tool_result blocks for tool calls', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

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

    useRealTimers();
    restoreTime();
  });

  it('includes redacted tool input when explicitly enabled', () => {
    const { lines, write } = collectLines();

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-tool-input',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
      includeToolInput: true,
    });

    reporter.onStart('x');

    reporter.onEvent({
      type: 'tool.call.start',
      callId: 'call-1',
      toolName: 'agent_dispatch',
      phase: 'PATCH',
      round: 1,
      input: { agent_ref: 'reviewer', task: 'Inspect the patch.' },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });

    const toolUseStart = lines.find(
      (l) =>
        l.parent_tool_use_id === 'call-1' &&
        l.event?.type === 'content_block_start' &&
        l.event?.content_block?.type === 'tool_use',
    ) as any;

    expect(toolUseStart).toMatchObject({
      session_id: 'sess-tool-input',
      parent_tool_use_id: 'call-1',
      event: {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'call-1',
          name: 'agent_dispatch',
          input: { agent_ref: 'reviewer', task: 'Inspect the patch.' },
        },
      },
    });
  });

  it('waits for execution input before emitting provider-derived tool_use when enabled', () => {
    const { lines, write } = collectLines();

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-tool-input-provider',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
      includeToolInput: true,
    });

    reporter.onStart('x');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      phase: 'PATCH',
      round: 1,
      source: 'provider',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'agent_dispatch',
          arguments: '{}',
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });

    expect(
      lines.some(
        (l) =>
          l.parent_tool_use_id === 'call-1' &&
          l.event?.type === 'content_block_start' &&
          l.event?.content_block?.type === 'tool_use',
      ),
    ).toBe(false);

    reporter.onEvent({
      type: 'tool.call.start',
      callId: 'call-1',
      toolName: 'agent_dispatch',
      phase: 'PATCH',
      round: 1,
      input: { agent_ref: 'reviewer', task: 'Inspect the patch.' },
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });

    const toolUseStarts = lines.filter(
      (l) =>
        l.parent_tool_use_id === 'call-1' &&
        l.event?.type === 'content_block_start' &&
        l.event?.content_block?.type === 'tool_use',
    );

    expect(toolUseStarts).toHaveLength(1);
    expect(toolUseStarts[0]).toMatchObject({
      session_id: 'sess-tool-input-provider',
      parent_tool_use_id: 'call-1',
      event: {
        type: 'content_block_start',
        timestamp: '2026-02-20T00:00:01.000Z',
        content_block: {
          type: 'tool_use',
          id: 'call-1',
          name: 'agent_dispatch',
          input: { agent_ref: 'reviewer', task: 'Inspect the patch.' },
        },
      },
    });
  });

  it('emits tool_use from canonical model tool-call request and suppresses host start duplication', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

    const { lines, write } = collectLines();

    const reporter = new StreamJsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-tool-canonical',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('x');

    reporter.onEvent({
      type: 'llm.responses.event',
      kind: 'plan',
      step: 'PLAN',
      streamId: 'stream-1',
      phase: 'PATCH',
      round: 1,
      source: 'provider',
      event: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'fs.readFile',
          arguments: '{}',
        },
      },
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    });

    reporter.onEvent({
      type: 'tool.call.start',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      timestamp: new Date('2026-02-20T00:00:02.000Z'),
    });

    reporter.onEvent({
      type: 'tool.call.end',
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      round: 1,
      status: 'ok',
      durationMs: 12,
      timestamp: new Date('2026-02-20T00:00:03.000Z'),
    });

    const toolUseStarts = lines.filter(
      (l) =>
        l.parent_tool_use_id === 'call-1' &&
        l.event?.type === 'content_block_start' &&
        l.event?.content_block?.type === 'tool_use',
    );
    expect(toolUseStarts).toHaveLength(1);
    expect(toolUseStarts[0]?.event?.timestamp).toBe('2026-02-20T00:00:01.000Z');

    const toolResultStarts = lines.filter(
      (l) =>
        l.parent_tool_use_id === 'call-1' &&
        l.event?.type === 'content_block_start' &&
        l.event?.content_block?.type === 'tool_result',
    );
    expect(toolResultStarts).toHaveLength(1);
    expect(toolResultStarts[0]?.event?.timestamp).toBe('2026-02-20T00:00:03.000Z');

    useRealTimers();
    restoreTime();
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
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

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

    useRealTimers();
    restoreTime();
  });

  it('includes audit_path on error events when provided', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

    const { lines, write } = collectLines();
    const reporter = new StreamJsonReporter({
      sessionId: 'sess-error-audit',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('x');
    const err = new Error('Boom');
    (err as any).auditPath = '/tmp/audit.json';
    reporter.onError(err);

    const errorLine = lines.find((line) => line.event?.type === 'error');
    expect(errorLine).toMatchObject({
      event_seq: 1,
      event: {
        type: 'error',
        audit_path: '/tmp/audit.json',
      },
    });

    useRealTimers();
    restoreTime();
  });
});
