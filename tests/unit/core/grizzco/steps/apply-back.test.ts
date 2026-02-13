const { runApplyBackPhaseMock } = vi.hoisted(() => ({
  runApplyBackPhaseMock: vi.fn(),
}));

vi.mock('../../../../../src/core/grizzco/runtime/apply-back-runtime.js', () => ({
  runApplyBackPhase: runApplyBackPhaseMock,
}));

import { runApplyBack } from '../../../../../src/core/grizzco/steps/apply-back.js';

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    verifyResult: { ok: true },
    options: {
      dryRun: false,
      strategy: 'worktree',
      repoPath: '/repo',
    },
    applyBackRuntime: {
      checkpointRef: {
        baseRef: 'base-ref',
        worktreePath: '/shadow',
      },
      initialSnapshotHash: 'snapshot-ref',
      synchronizer: {} as any,
      activeRepoPath: '/shadow',
      shadowTaskId: 'shadow-task',
    },
    emit: vi.fn(),
    diff: 'diff --git a/a.ts b/a.ts',
    changedFiles: ['a.ts'],
    attempt: 2,
    ...overrides,
  };
}

describe('apply-back step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when verify is not ok', async () => {
    const result = await runApplyBack(
      createCtx({
        verifyResult: { ok: false },
      }) as any,
    );

    expect(result.applyBackResult).toEqual({
      success: true,
      skipped: true,
      telemetry: {},
    });
    expect(runApplyBackPhaseMock).not.toHaveBeenCalled();
  });

  it('skips when dryRun is enabled', async () => {
    const result = await runApplyBack(
      createCtx({
        options: {
          dryRun: true,
          strategy: 'worktree',
          repoPath: '/repo',
        },
      }) as any,
    );

    expect(result.applyBackResult?.skipped).toBe(true);
    expect(runApplyBackPhaseMock).not.toHaveBeenCalled();
  });

  it('skips when runtime is missing', async () => {
    const result = await runApplyBack(
      createCtx({
        applyBackRuntime: undefined,
      }) as any,
    );

    expect(result.applyBackResult?.skipped).toBe(true);
    expect(runApplyBackPhaseMock).not.toHaveBeenCalled();
  });

  it('skips when strategy is not worktree', async () => {
    const result = await runApplyBack(
      createCtx({
        options: {
          dryRun: false,
          strategy: 'direct',
          repoPath: '/repo',
        },
      }) as any,
    );

    expect(result.applyBackResult?.skipped).toBe(true);
    expect(runApplyBackPhaseMock).not.toHaveBeenCalled();
  });

  it('uses attempt fallback of 1 when attempt is missing', async () => {
    runApplyBackPhaseMock.mockResolvedValueOnce({
      success: true,
      skipped: false,
      telemetry: {},
    });

    await runApplyBack(
      createCtx({
        attempt: undefined,
      }) as any,
    );

    expect(runApplyBackPhaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
      }),
    );
  });

  it('sets lastError when apply-back fails', async () => {
    runApplyBackPhaseMock.mockResolvedValueOnce({
      success: false,
      skipped: false,
      telemetry: {},
      error: 'apply-back failed',
    });

    const result = await runApplyBack(createCtx() as any);

    expect(result.applyBackResult?.success).toBe(false);
    expect(result.lastError).toBe('apply-back failed');
  });
});
