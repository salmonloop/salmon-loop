import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { LoopTelemetry } from '../../../../../../src/core/grizzco/engine/observability/loop-telemetry.js';
import { FlowTransactionRunner } from '../../../../../../src/core/grizzco/engine/transaction/transaction-runner.js';
import * as flowDispatch from '../../../../../../src/core/grizzco/flows/flow-dispatch.js';
import type { ToolResultReplacementState } from '../../../../../../src/core/session/replacement-state.js';

mock.module('../../../../../../src/core/grizzco/flows/flow-dispatch.js', () => ({
  executeFlowAttempt: mock(),
}));

const NOW = new Date('2026-02-13T00:00:00.000Z');

function createRunner(
  emit = mock(),
  optionsOverrides: Record<string, unknown> = {},
  flowMode: any = 'patch',
) {
  return new FlowTransactionRunner({
    options: {
      instruction: 'fix',
      repoPath: '/repo',
      llm: {} as any,
      ...optionsOverrides,
    } as any,
    flowMode,
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
    mockedExecute = spyOn(flowDispatch, 'executeFlowAttempt').mockReset();
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

  it('routes autopilot attempts through the shared flow dispatch', async () => {
    mockedExecute.mockResolvedValueOnce({
      success: true,
      duration: 1,
      traces: [],
      data: {
        report: {
          kind: 'answer',
          timestamp: Date.now(),
        },
      },
    } as any);

    await createRunner(mock(), {}, 'autopilot').execute();

    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        mode: 'autopilot',
      }),
    );
  });

  it('passes prior sub-agent artifacts into the next retry attempt', async () => {
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
          toolCallingAudit: [
            {
              phase: 'PLAN',
              toolName: 'agent_dispatch',
              toolResultStatus: 'ok',
              toolResultPatchArtifact: {
                handle: 's8p://artifact/subagent-patch-123',
                mimeType: 'text/x-diff',
                sha256: 'patch',
                size: 456,
              },
              toolResultAuditArtifact: {
                handle: 's8p://artifact/subagent-audit-456',
                mimeType: 'application/json',
                sha256: 'audit',
                size: 789,
              },
            },
          ],
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

    await createRunner().execute();

    expect(mockedExecute).toHaveBeenCalledTimes(2);
    expect(mockedExecute.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        artifactHints: expect.objectContaining({
          subAgentPatchArtifacts: [
            expect.objectContaining({
              handle: 's8p://artifact/subagent-patch-123',
            }),
          ],
          subAgentAuditArtifacts: [
            expect.objectContaining({
              handle: 's8p://artifact/subagent-audit-456',
            }),
          ],
        }),
      }),
    );
  });

  it('seeds first attempt artifact hints from loop options', async () => {
    mockedExecute.mockResolvedValueOnce({
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

    await createRunner(mock(), {
      artifactHints: {
        verifyArtifact: {
          handle: 's8p://artifact/verify-seed',
          mimeType: 'text/plain',
          sha256: 'verify-seed',
          size: 100,
        },
        recentReadArtifacts: [
          {
            path: 'src/seed.ts',
            artifact: {
              handle: 's8p://artifact/read-seed',
              mimeType: 'text/plain',
              sha256: 'read-seed',
              size: 120,
            },
          },
        ],
      },
    } as any).execute();

    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        artifactHints: expect.objectContaining({
          verifyArtifact: expect.objectContaining({ handle: 's8p://artifact/verify-seed' }),
          recentReadArtifacts: [
            expect.objectContaining({
              path: 'src/seed.ts',
              artifact: expect.objectContaining({ handle: 's8p://artifact/read-seed' }),
            }),
          ],
        }),
      }),
    );
  });

  it('passes prior recent read artifacts into the next retry attempt', async () => {
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
          toolCallingAudit: [
            {
              phase: 'EXPLORE',
              toolName: 'fs.read',
              toolIntent: 'READ',
              toolResultStatus: 'ok',
              toolResultReadArtifactPath: 'src/recent.ts',
              toolResultReadArtifact: {
                handle: 's8p://artifact/recent-read-123',
                mimeType: 'text/plain',
                sha256: 'read',
                size: 321,
              },
            },
          ],
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

    await createRunner().execute();

    expect(mockedExecute).toHaveBeenCalledTimes(2);
    expect(mockedExecute.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        artifactHints: expect.objectContaining({
          recentReadArtifacts: [
            expect.objectContaining({
              path: 'src/recent.ts',
              artifact: expect.objectContaining({
                handle: 's8p://artifact/recent-read-123',
              }),
            }),
          ],
        }),
      }),
    );
  });

  it('passes prior tool result preview artifacts into the next retry attempt', async () => {
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
          toolCallingAudit: [
            {
              phase: 'EXPLORE',
              toolName: 'web.search',
              toolResultStatus: 'ok',
              toolResultPreviewLabel: 'Tool result preview: web.search output',
              toolResultPreviewArtifact: {
                handle: 's8p://artifact/tool-preview-123',
                mimeType: 'application/json',
                sha256: 'preview',
                size: 1600,
              },
            },
          ],
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

    await createRunner().execute();

    expect(mockedExecute).toHaveBeenCalledTimes(2);
    expect(mockedExecute.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        artifactHints: expect.objectContaining({
          toolResultPreviewArtifacts: [
            expect.objectContaining({
              label: 'Tool result preview: web.search output',
              artifact: expect.objectContaining({
                handle: 's8p://artifact/tool-preview-123',
              }),
            }),
          ],
        }),
      }),
    );
  });

  it('reuses replacement state across retries when no new state is provided', async () => {
    const replacementState: ToolResultReplacementState = {
      schemaVersion: 1,
      entries: {
        'tool-preview-1': {
          toolResultId: 'tool-preview-1',
          decision: 'replaced',
          preview: 'stable-preview-bytes',
          frozenAt: 10,
          sourceArtifactHandle: 's8p://artifact/preview-1',
          identityVersion: 'v1',
          hashAlgorithm: 'sha256',
        },
      },
    };

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

    await createRunner(mock(), { replacementState }).execute();

    expect(mockedExecute).toHaveBeenCalledTimes(2);
    expect(mockedExecute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        replacementState,
      }),
    );
    expect(mockedExecute.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        replacementState,
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

  it('does not treat autopilot success as apply-back failure in preserve mode', async () => {
    mockedExecute.mockResolvedValue({
      success: true,
      duration: 1,
      traces: [],
      data: {
        report: {
          kind: 'answer',
          summary: 'autopilot finished',
          timestamp: Date.now(),
        },
        mutated: true,
        verifyResult: { ok: true, output: 'ok', exitCode: 0 },
        applyBackResult: {
          success: false,
          skipped: false,
          error: 'apply back should be ignored',
          telemetry: {},
        },
      },
    } as any);

    const report = await createRunner(mock(), {}, 'autopilot').execute();

    expect(report.success).toBe(true);
    expect(report.terminalReasonCode).toBeUndefined();
    expect((report.lastContext as any)?.report?.summary).toBe('autopilot finished');
  });

  it('preserves autopilot terminal context even when no verify gate ran', async () => {
    mockedExecute.mockResolvedValue({
      success: true,
      duration: 1,
      traces: [],
      data: {
        report: {
          kind: 'answer',
          summary: 'autopilot answer',
          timestamp: Date.now(),
        },
        mutated: false,
      },
    } as any);

    const report = await createRunner(mock(), {}, 'autopilot').execute();

    expect(report.success).toBe(true);
    expect((report.lastContext as any)?.report?.summary).toBe('autopilot answer');
  });

  it('preserves autopilot terminal context when verify fails in preserve mode', async () => {
    mockedExecute.mockResolvedValue({
      success: true,
      duration: 1,
      traces: [],
      data: {
        report: {
          kind: 'answer',
          summary: 'autopilot verify failed',
          timestamp: Date.now(),
        },
        mutated: true,
        verifyResult: { ok: false, output: 'resource lock error: file lock', exitCode: 1 },
      },
    } as any);

    const report = await createRunner(mock(), {}, 'autopilot').execute();

    expect(report.success).toBe(false);
    expect(report.terminalReasonCode).toBe('VERIFY_FAILED');
    expect(report.terminalFailurePhase).toBe('VERIFY');
    expect((report.lastContext as any)?.report?.summary).toBe('autopilot verify failed');
    expect((report.lastContext as any)?.verifyResult).toEqual(
      expect.objectContaining({
        ok: false,
        output: 'resource lock error: file lock',
      }),
    );
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

  it('preserves the last failed phase when retryable LLM errors exhaust retries', async () => {
    mockedExecute.mockResolvedValue({
      success: false,
      duration: 1,
      traces: [
        {
          name: 'EXPLORE',
          start: 0,
          end: 1,
          duration: 1,
          error: 'LLM request failed',
          metadata: {
            name: 'LlmError',
            code: 'LLM_HTTP_REQUEST_FAILED',
            llmCode: 'LLM_HTTP_REQUEST_FAILED',
          },
        },
      ],
      error: Object.assign(new Error('LLM request failed'), {
        code: 'LLM_HTTP_REQUEST_FAILED',
        llmCode: 'LLM_HTTP_REQUEST_FAILED',
      }),
      data: {
        context: { repoPath: '/repo', rgSnippets: [] },
      },
    } as any);

    const report = await createRunner().execute();

    expect(report.success).toBe(false);
    expect(report.retryExhausted).toBe(true);
    expect(report.attempts).toBe(3);
    expect(report.lastErrorCode).toBe('LLM_HTTP_REQUEST_FAILED');
    expect(report.terminalFailurePhase).toBe('EXPLORE');
    expect(report.terminalDiagnosticCode).toBe('LLM_HTTP_REQUEST_FAILED');
  });

  it('does not retry when an explore phase LLM auth failure is non-retryable', async () => {
    mockedExecute.mockResolvedValue({
      success: false,
      duration: 1,
      traces: [
        {
          name: 'EXPLORE',
          start: 0,
          end: 1,
          duration: 1,
          error: 'LLM authentication failed',
          metadata: {
            name: 'LlmError',
            code: 'LLM_AUTHENTICATION_FAILED',
            llmCode: 'LLM_AUTHENTICATION_FAILED',
          },
        },
      ],
      error: Object.assign(new Error('LLM authentication failed'), {
        code: 'LLM_AUTHENTICATION_FAILED',
        llmCode: 'LLM_AUTHENTICATION_FAILED',
      }),
      data: {
        context: { repoPath: '/repo', rgSnippets: [] },
      },
    } as any);

    const emit = mock();
    const report = await createRunner(emit).execute();

    expect(report.success).toBe(false);
    expect(report.attempts).toBe(1);
    expect(report.retryExhausted).toBe(false);
    expect(report.lastErrorCode).toBe('LLM_AUTHENTICATION_FAILED');
    expect(report.terminalFailurePhase).toBe('EXPLORE');
    expect(report.terminalDiagnosticCode).toBe('LLM_AUTHENTICATION_FAILED');
    expect(emit).not.toHaveBeenCalled();
  });
});
