const { recordAuditEventMock, writeDebugArtifactMock } = vi.hoisted(() => ({
  recordAuditEventMock: vi.fn(),
  writeDebugArtifactMock: vi.fn().mockResolvedValue({
    path: 'blobs/apply-back-error-test.log',
    sha256: 'sha256-test',
    chars: 12,
  }),
}));

vi.mock('../../../../../src/core/observability/audit-trail.js', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

vi.mock('../../../../../src/core/observability/debug-artifacts.js', () => ({
  writeDebugArtifact: writeDebugArtifactMock,
}));

import { text } from '../../../../../src/locales/index.js';

function createSynchronizer(overrides: Record<string, unknown> = {}) {
  return {
    createCheckpointCommit: vi.fn().mockResolvedValue('final-ref-1'),
    applyBackToMainWorkspace: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createParams(overrides: Record<string, unknown> = {}) {
  const synchronizer = createSynchronizer();
  const emit = vi.fn();
  return {
    attempt: 1,
    options: {
      repoPath: '/repo',
      strategy: 'worktree',
      applyBackOnDirty: '3way',
      contextFiles: ['a.ts', '', 'a.ts', 'b.ts'],
    } as any,
    checkpointRef: {
      baseRef: 'base-ref',
      worktreePath: '/shadow',
    } as any,
    initialSnapshotHash: 'snapshot-ref',
    synchronizer: synchronizer as any,
    activeRepoPath: '/shadow',
    shadowTaskId: 'shadow-task',
    emit,
    diff: 'diff --git a/a.ts b/a.ts',
    changedFiles: ['a.ts'],
    ...overrides,
  };
}

describe('apply-back-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates and filters sidecar paths', async () => {
    const { collectSidecarPaths } =
      await import('../../../../../src/core/grizzco/runtime/apply-back-utils.js');
    expect(collectSidecarPaths({} as any)).toEqual([]);
    expect(collectSidecarPaths({ contextFiles: [] } as any)).toEqual([]);
    expect(
      collectSidecarPaths({
        contextFiles: ['a.ts', '', 'a.ts', undefined, 'b.ts', null],
      } as any),
    ).toEqual(['a.ts', 'b.ts']);
  });

  it('skips apply-back when checkpoint is missing', async () => {
    const { runApplyBackPhase } =
      await import('../../../../../src/core/grizzco/runtime/apply-back-runtime.js');
    const synchronizer = createSynchronizer();
    const result = await runApplyBackPhase(
      createParams({
        checkpointRef: undefined,
        synchronizer,
      }) as any,
    );

    expect(result).toEqual({
      success: true,
      skipped: true,
      telemetry: {},
    });
    expect(synchronizer.createCheckpointCommit).not.toHaveBeenCalled();
    expect(synchronizer.applyBackToMainWorkspace).not.toHaveBeenCalled();
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'apply_back.skipped',
      expect.objectContaining({ attempt: 1 }),
      expect.objectContaining({ phase: 'APPLY_BACK' }),
    );
  });

  it('skips apply-back when strategy is not worktree', async () => {
    const { runApplyBackPhase } =
      await import('../../../../../src/core/grizzco/runtime/apply-back-runtime.js');
    const synchronizer = createSynchronizer();
    const result = await runApplyBackPhase(
      createParams({
        synchronizer,
        options: {
          repoPath: '/repo',
          strategy: 'direct',
        },
      }) as any,
    );

    expect(result.skipped).toBe(true);
    expect(synchronizer.createCheckpointCommit).not.toHaveBeenCalled();
    expect(synchronizer.applyBackToMainWorkspace).not.toHaveBeenCalled();
  });

  it('runs apply-back successfully and forwards deduped sidecar paths', async () => {
    const { runApplyBackPhase } =
      await import('../../../../../src/core/grizzco/runtime/apply-back-runtime.js');
    const synchronizer = createSynchronizer({
      createCheckpointCommit: vi.fn().mockResolvedValue('final-ref-2'),
    });
    const emit = vi.fn();
    const params = createParams({ synchronizer, emit }) as any;

    const result = await runApplyBackPhase(params);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(synchronizer.createCheckpointCommit).toHaveBeenCalledWith(
      '/shadow',
      'shadow-task',
      'final-1',
    );
    expect(synchronizer.applyBackToMainWorkspace).toHaveBeenCalledTimes(1);

    const applyCall = vi.mocked(synchronizer.applyBackToMainWorkspace).mock.calls[0];
    expect(applyCall?.[0]).toBe('/repo');
    expect(applyCall?.[1]).toBe(params.checkpointRef);
    expect(applyCall?.[2]).toBe('diff --git a/a.ts b/a.ts');
    expect(applyCall?.[7]).toBe('final-ref-2');
    expect(applyCall?.[8]).toEqual(['a.ts', 'b.ts']);

    expect(emit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'log', level: 'info' }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'log', level: 'info' }),
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'apply_back.success',
      expect.objectContaining({ attempt: 1 }),
      expect.objectContaining({ phase: 'APPLY_BACK' }),
    );
  });

  it('falls back to checkpoint base ref when final checkpoint is unavailable', async () => {
    const { runApplyBackPhase } =
      await import('../../../../../src/core/grizzco/runtime/apply-back-runtime.js');
    const synchronizer = createSynchronizer({
      createCheckpointCommit: vi.fn().mockResolvedValue(undefined),
    });
    const params = createParams({ synchronizer }) as any;

    const result = await runApplyBackPhase(params);

    expect(result.success).toBe(true);
    const applyCall = vi.mocked(synchronizer.applyBackToMainWorkspace).mock.calls[0];
    expect(applyCall?.[7]).toBe('base-ref');
  });

  it('returns safe error details when apply-back fails', async () => {
    const { runApplyBackPhase } =
      await import('../../../../../src/core/grizzco/runtime/apply-back-runtime.js');
    const synchronizer = createSynchronizer({
      applyBackToMainWorkspace: vi.fn().mockRejectedValue(new Error('merge conflict')),
    });
    const emit = vi.fn();

    const result = await runApplyBackPhase(
      createParams({
        synchronizer,
        emit,
      }) as any,
    );

    expect(result).toEqual({
      success: false,
      skipped: false,
      telemetry: {},
      error: text.loop.applyBackFailedSync,
      errorCode: 'APPLY_BACK_FAILED',
      safeMessage: text.loop.applyBackFailedSync,
      safeMeta: expect.objectContaining({
        stage: 'applyBackToMain',
        attempt: 1,
        changedFiles: 1,
        applyBackOnDirty: '3way',
      }),
      debugArtifact: {
        path: 'blobs/apply-back-error-test.log',
        sha256: 'sha256-test',
        chars: 12,
      },
    });
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'apply_back.failure',
      expect.objectContaining({
        attempt: 1,
        errorCode: 'APPLY_BACK_FAILED',
        safeMessage: text.loop.applyBackFailedSync,
      }),
      expect.objectContaining({ phase: 'APPLY_BACK' }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'error',
        message: text.loop.applyBackFailedSync,
        code: 'APPLY_BACK_FAILED',
      }),
    );
  });
});
