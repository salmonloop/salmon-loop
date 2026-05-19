import { describe, expect, it } from 'bun:test';

import { createStdoutWriter } from '../../../../src/cli/headless/stdout-writer.js';
import { JsonReporter } from '../../../../src/cli/reporters/json.js';
import type { LoopEvent, LoopResult } from '../../../../src/core/types/index.js';
import { freezeSystemTime } from '../../../helpers/time.js';

describe('JsonReporter', () => {
  it('emits a single JSON object on finish', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

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
      reason: 'Operation completed successfully',
      reasonCode: 'SUCCESS',
      diagnosticCode: 'SUCCESS',
      safeHint: 'Completed successfully.',
      remediationSteps: [],
      attempts: 1,
      logs: [],
      changedFiles: ['src/a.ts'],
      benchmarkPatchArtifact: {
        kind: 'git-unified-diff',
        path: '/tmp/patch.diff',
        sha256: 'a'.repeat(64),
        bytes: 12,
        changedFiles: ['src/a.ts'],
        isEmpty: false,
      },
      benchmarkArtifact: {
        provider: 'swe-bench',
        instanceId: 'repo__project-1',
        modelNameOrPath: 'salmon-loop',
        predictionsPath: '/tmp/predictions.jsonl',
      },
      usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
      authorizationDecisions: [
        {
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
          timestamp: '2026-02-20T00:00:00.000Z',
        },
      ],
    };
    reporter.onFinish(result);

    const obj = JSON.parse(out.trim());
    expect(obj).toMatchObject({
      result: 'Done',
      structured_output: null,
      session_id: 'sess-1',
    });
    expect(obj.metadata).toMatchObject({
      schema_version: 1,
      command: 'run',
      repo_path: '/repo',
      instruction: 'do the thing',
      success: true,
      exit_code: 0,
      reason: 'Operation completed successfully',
      reason_code: 'SUCCESS',
      diagnostic_code: 'SUCCESS',
      safe_hint: 'Completed successfully.',
      remediation_steps: [],
      attempts: 1,
      changed_files: ['src/a.ts'],
      patch_artifact: {
        kind: 'git-unified-diff',
        path: '/tmp/patch.diff',
        sha256: 'a'.repeat(64),
        bytes: 12,
        changed_files: ['src/a.ts'],
        is_empty: false,
      },
      benchmark_artifact: {
        provider: 'swe-bench',
        instance_id: 'repo__project-1',
        model_name_or_path: 'salmon-loop',
        predictions_path: '/tmp/predictions.jsonl',
      },
      run_end: {
        success: true,
        timestamp: '2026-02-20T00:00:00.000Z',
        exit_code: 0,
      },
      usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
      warnings: [],
      authorization_decisions: [
        {
          call_id: 'call-1',
          tool_name: 'fs.readFile',
          phase: 'PATCH',
          outcome: 'allow_once',
          source: 'user',
          reason: 'ok',
          ttl_ms: 123,
          persist: 'repo',
          risk_level: 'low',
          side_effects: ['read'],
          timestamp: '2026-02-20T00:00:00.000Z',
        },
      ],
    });

    useRealTimers();
    restoreTime();
  });

  it('keeps retry exhaustion reason separate from terminal failure guidance', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

    let out = '';
    const write = (chunk: string) => {
      out += chunk;
      return true;
    };

    const reporter = new JsonReporter({
      mode: 'run',
      repoPath: '/repo',
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

    const obj = JSON.parse(out.trim());
    expect(obj.metadata).toMatchObject({
      success: false,
      reason: 'Exceeded maximum retry attempts',
      reason_code: 'MAX_RETRIES',
      diagnostic_code: 'VERIFY_FAILED',
      safe_hint: 'Verification failed.',
      remediation_steps: ['Fix the failing verification and retry.'],
      changed_files: ['data.txt'],
    });

    useRealTimers();
    restoreTime();
  });

  it('uses exit code 130 for user cancellation', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

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

    useRealTimers();
    restoreTime();
  });

  it('supports structured_output and payload overrides', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

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

    useRealTimers();
    restoreTime();
  });

  it('includes structured warnings for headless callers', () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-20T00:00:00.000Z');

    let out = '';
    const write = (chunk: string) => {
      out += chunk;
      return true;
    };

    const reporter = new JsonReporter({
      sessionId: 'sess-warnings',
      now: () => new Date(),
      writer: createStdoutWriter({ write }),
      getWarnings: () => [
        {
          code: 'LLM_CREDENTIAL_MISSING',
          message: 'LLM credential not configured; using StubLLM.',
          source: 'llm.runtime',
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

    const obj = JSON.parse(out.trim());
    expect(obj.metadata.warnings).toEqual([
      {
        code: 'LLM_CREDENTIAL_MISSING',
        message: 'LLM credential not configured; using StubLLM.',
        source: 'llm.runtime',
        severity: 'warning',
      },
    ]);

    useRealTimers();
    restoreTime();
  });
});
