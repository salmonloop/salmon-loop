import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { LoopTelemetry } from '../../../../../../src/core/grizzco/engine/observability/loop-telemetry.js';
import { FlowTransactionRunner } from '../../../../../../src/core/grizzco/engine/transaction/transaction-runner.js';
import * as salmonFlow from '../../../../../../src/core/grizzco/flows/SalmonLoopFlow.js';

mock.module('../../../../../../src/core/grizzco/flows/SalmonLoopFlow.js', () => ({
  executeSalmonLoopFlow: mock(),
}));

const NOW = new Date('2026-02-13T00:00:00.000Z');

function createRunner(emit = mock()) {
  return new FlowTransactionRunner({
    options: {
      instruction: 'fix',
      repoPath: '/repo',
      llm: {} as any,
    } as any,
    flowMode: 'patch',
    emit,
    now: () => NOW,
    fsAdapter: {} as any,
    env: {
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'worktree',
      } as any,
      shadowInitialRef: 'snapshot-ref',
      initialSnapshotHash: 'snapshot-ref',
      activeRepoPath: '/repo',
    },
    synchronizer: {} as any,
    shadowTaskId: 'shadow-1',
    fileStateResolver: {} as any,
    telemetry: new LoopTelemetry(() => NOW),
  });
}

describe('transaction-runner', () => {
  let mockedExecute: any;

  beforeEach(() => {
    mock.clearAllMocks();
    mockedExecute = spyOn(salmonFlow, 'executeSalmonLoopFlow').mockReset();
  });

  it('retries only when verify error is retryable and keeps success attempt history clean', async () => {
    mockedExecute
      .mockResolvedValueOnce({
        success: true,
        duration: 1,
        traces: [],
        data: {
          context: { repoPath: '/repo', rgSnippets: [] },
          verifyResult: { ok: false, output: 'Test suites: 1 failed, 1 total', exitCode: 1 },
          lastError: 'tests failed',
          plan: null,
          diff: null,
        },
      } as any)
      .mockResolvedValueOnce({
        success: true,
        duration: 1,
        traces: [],
        data: {
          context: { repoPath: '/repo', rgSnippets: [] },
          verifyResult: { ok: true, output: 'ok', exitCode: 0 },
          applyBackResult: { success: true, skipped: false, telemetry: {} },
          plan: null,
          diff: 'diff --git a/a.ts b/a.ts',
          changedFiles: ['a.ts'],
        },
      } as any);

    const emit = mock();
    const report = await createRunner(emit).execute();

    expect(report.success).toBe(true);
    expect(report.attempts).toBe(2);
    expect(report.history).toHaveLength(2);
    expect(report.history[0]?.error).toBeDefined();
    expect(report.history[1]?.error).toBeUndefined();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'retry',
        fromAttempt: 1,
        toAttempt: 2,
      }),
    );
  });

  it('emits task.awaiting_input when ask_user is required', async () => {
    const inputRequired = {
      type: 'question',
      reason: 'clarification',
      prompt: 'Pick one',
      questions: [
        {
          question: 'Which option?',
          header: 'Pick',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    };

    mockedExecute.mockResolvedValueOnce({
      success: false,
      duration: 1,
      traces: [],
      error: {
        code: 'INTERRUPT_REQUIRED',
        interrupt: {
          type: 'awaiting_input',
          reason: 'clarification',
          prompt: 'Pick one',
          data: { inputRequired },
        },
      },
      data: {
        context: { repoPath: '/repo', rgSnippets: [] },
      },
    } as any);

    const emit = mock();
    const report = await createRunner(emit).execute();

    expect(report.success).toBe(false);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.awaiting_input',
        reason: 'clarification',
        prompt: 'Pick one',
        inputRequired,
      }),
    );
  });

  it('terminates immediately when verify error is non-retryable', async () => {
    mockedExecute.mockResolvedValue({
      success: true,
      duration: 1,
      traces: [],
      data: {
        context: { repoPath: '/repo', rgSnippets: [] },
        verifyResult: { ok: false, output: 'resource lock error: file lock', exitCode: 1 },
        lastError: 'resource lock error',
        plan: null,
        diff: null,
      },
    } as any);

    const emit = mock();
    const report = await createRunner(emit).execute();

    expect(report.success).toBe(false);
    expect(report.attempts).toBe(1);
    expect(report.retryExhausted).toBe(false);
    expect(report.terminalReasonCode).toBe('VERIFY_FAILED');
    expect(report.terminalFailurePhase).toBe('VERIFY');
    expect(emit).not.toHaveBeenCalled();
  });

  it('maps coded preflight errors to terminal reason code without retry', async () => {
    mockedExecute.mockResolvedValue({
      success: false,
      duration: 1,
      traces: [],
      lastStep: 'PREFLIGHT',
      error: Object.assign(new Error('not git'), { code: 'PREFLIGHT_NOT_GIT' }),
      data: undefined,
    } as any);

    const report = await createRunner().execute();

    expect(report.success).toBe(false);
    expect(report.attempts).toBe(1);
    expect(report.terminalReasonCode).toBe('PREFLIGHT_NOT_GIT');
    expect(report.terminalFailurePhase).toBe('PREFLIGHT');
    expect(report.retryExhausted).toBe(false);
  });

  it('maps apply-back failures to terminal APPLY_BACK_FAILED', async () => {
    mockedExecute.mockResolvedValue({
      success: true,
      duration: 1,
      traces: [],
      data: {
        context: { repoPath: '/repo', rgSnippets: [] },
        verifyResult: { ok: true, output: 'ok', exitCode: 0 },
        applyBackResult: {
          success: false,
          skipped: false,
          error: 'apply back failed',
          telemetry: {},
        },
        plan: null,
        diff: 'diff --git a/a.ts b/a.ts',
      },
    } as any);

    const report = await createRunner().execute();

    expect(report.success).toBe(false);
    expect(report.terminalReasonCode).toBe('APPLY_BACK_FAILED');
    expect(report.terminalFailurePhase).toBe('APPLY_BACK');
    expect(report.retryExhausted).toBe(false);
    expect(report.history[0]?.error).toBe('apply back failed');
  });

  it('does not retry when context phase requires cache permission authorization', async () => {
    mockedExecute.mockResolvedValue({
      success: false,
      duration: 1,
      traces: [
        { name: 'CONTEXT', error: { code: 'PERMISSION_REQUIRED_CONTEXT_CACHE_OUTSIDE_ROOT' } },
      ],
      error: Object.assign(new Error('permission required'), {
        code: 'PERMISSION_REQUIRED_CONTEXT_CACHE_OUTSIDE_ROOT',
      }),
      data: undefined,
    } as any);

    const emit = mock();
    const report = await createRunner(emit).execute();

    expect(report.success).toBe(false);
    expect(report.attempts).toBe(1);
    expect(report.retryExhausted).toBe(false);
    expect(report.terminalReasonCode).toBe('LOOP_FAILED');
    expect(report.lastErrorCode).toBe('PERMISSION_REQUIRED_CONTEXT_CACHE_OUTSIDE_ROOT');
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not retry when context phase denies cache permission from trace code only', async () => {
    mockedExecute.mockResolvedValue({
      success: false,
      duration: 1,
      traces: [
        { name: 'CONTEXT', error: { code: 'PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT' } },
      ],
      data: undefined,
    } as any);

    const emit = mock();
    const report = await createRunner(emit).execute();

    expect(report.success).toBe(false);
    expect(report.attempts).toBe(1);
    expect(report.retryExhausted).toBe(false);
    expect(report.lastErrorCode).toBe('PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT');
    expect(emit).not.toHaveBeenCalled();
  });

  it('marks retry exhaustion after max retryable verify failures', async () => {
    mockedExecute.mockResolvedValue({
      success: true,
      duration: 1,
      traces: [],
      data: {
        context: { repoPath: '/repo', rgSnippets: [] },
        verifyResult: { ok: false, output: 'TS2322: Type string is not assignable', exitCode: 1 },
        lastError: 'type error',
        plan: null,
        diff: null,
      },
    } as any);

    const emit = mock();
    const report = await createRunner(emit).execute();

    expect(report.success).toBe(false);
    expect(report.retryExhausted).toBe(true);
    expect(report.attempts).toBe(3);
    expect(report.history).toHaveLength(3);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
