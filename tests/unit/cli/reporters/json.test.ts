import { describe, expect, it, vi } from 'vitest';

import { createStdoutWriter } from '../../../../src/cli/headless/stdout-writer.js';
import { JsonReporter } from '../../../../src/cli/reporters/json.js';
import type { LoopEvent, LoopResult } from '../../../../src/core/types/index.js';

describe('JsonReporter', () => {
  it('emits a single JSON object on finish', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    let out = '';
    const write = (chunk: string) => {
      out += chunk;
      return true;
    };

    const reporter = new JsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-1',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
    });

    reporter.onStart('do the thing');

    const assistantMessage: LoopEvent = {
      type: 'llm.output',
      kind: 'assistant_message',
      step: 'REPORT',
      content: 'Done',
      timestamp: new Date('2026-02-20T00:00:01.000Z'),
    };
    reporter.onEvent(assistantMessage);

    const result: LoopResult = {
      success: true,
      reason: 'SUCCESS',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      changedFiles: ['src/a.ts'],
      usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
    };
    reporter.onFinish(result);

    const obj = JSON.parse(out.trim());
    expect(obj).toMatchObject({
      result: 'Done',
      structured_output: null,
      session_id: 'sess-1',
    });
    expect(obj.metadata).toMatchObject({
      command: 'run',
      repo_path: '/repo',
      instruction: 'do the thing',
      success: true,
      exit_code: 0,
      reason: 'SUCCESS',
      reason_code: 'SUCCESS',
      attempts: 1,
      changed_files: ['src/a.ts'],
      usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
    });

    vi.useRealTimers();
  });

  it('uses exit code 130 for user cancellation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    let out = '';
    const write = (chunk: string) => {
      out += chunk;
      return true;
    };

    const reporter = new JsonReporter({
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

    const obj = JSON.parse(out.trim());
    expect(obj.metadata.exit_code).toBe(130);

    vi.useRealTimers();
  });

  it('supports structured_output and payload overrides', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T00:00:00.000Z'));

    let out = '';
    const write = (chunk: string) => {
      out += chunk;
      return true;
    };

    const reporter = new JsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-3',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
      getStructuredOutput: () => ({ files: ['a.ts'] }),
      getPayloadOverrides: () => ({
        success: false,
        exitCode: 1,
        reason: 'Structured output failed schema validation.',
        reasonCode: 'SCHEMA_VALIDATION_FAILED',
        errorCode: 'SCHEMA_VALIDATION_FAILED',
        structuredOutputError: 'Structured output failed schema validation.',
      }),
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

    const obj = JSON.parse(out.trim());
    expect(obj).toMatchObject({
      structured_output: { files: ['a.ts'] },
    });
    expect(obj.metadata).toMatchObject({
      success: false,
      exit_code: 1,
      reason: 'Structured output failed schema validation.',
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      error_code: 'SCHEMA_VALIDATION_FAILED',
      structured_output_error: 'Structured output failed schema validation.',
    });

    vi.useRealTimers();
  });
});
