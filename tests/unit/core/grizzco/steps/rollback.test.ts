const { safeRollbackMock, restoreToShadowMock } = (() => ({
  safeRollbackMock: mock(),
  restoreToShadowMock: mock(),
}))();

mock.module('../../../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation(() => ({
    safeRollback: safeRollbackMock,
  })),
}));

mock.module('../../../../../src/core/strata/checkpoint/manager.js', () => ({
  CheckpointManager: mock().mockImplementation(() => ({
    restoreToShadow: restoreToShadowMock,
  })),
}));

function createBaseCtx(overrides: Record<string, unknown> = {}): any {
  const emit = mock();
  return {
    options: {
      forceReset: false,
      dryRun: false,
      repoPath: '/main-repo',
    },
    workspace: {
      strategy: 'direct',
      workPath: '/main-repo',
      baseRepoPath: '/main-repo',
    },
    shadowInitialRef: 'snapshot-ref',
    changedFiles: ['target.ts'],
    verifyResult: { ok: false },
    emit,
    ...overrides,
  };
}

describe('rollback step safety behavior', () => {
  beforeEach(() => {
    mock.restore();
    safeRollbackMock.mockRejectedValue(new Error('unexpected direct rollback path'));
    restoreToShadowMock.mockRejectedValue(new Error('unexpected worktree rollback path'));
  });

  it('completes rollback through direct workspace strategy', async () => {
    const { runRollback } = await import('../../../../../src/core/grizzco/steps/rollback.js');
    safeRollbackMock.mockResolvedValue(undefined);
    const ctx = createBaseCtx();

    const result = await runRollback(ctx);

    expect(result.rolledBack).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'info',
      }),
    );
  });

  it('completes rollback through worktree strategy', async () => {
    const { runRollback } = await import('../../../../../src/core/grizzco/steps/rollback.js');
    restoreToShadowMock.mockResolvedValue(undefined);
    const ctx = createBaseCtx({
      workspace: {
        strategy: 'worktree',
        workPath: '/shadow-repo',
        baseRepoPath: '/main-repo',
      },
    });

    const result = await runRollback(ctx);

    expect(result.rolledBack).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'info',
      }),
    );
  });

  it('treats missing rollback anchor as already safe state', async () => {
    const { runRollback } = await import('../../../../../src/core/grizzco/steps/rollback.js');
    const ctx = createBaseCtx({
      shadowInitialRef: '',
      options: {
        forceReset: true,
        dryRun: false,
        repoPath: '/main-repo',
        shadowInitialRef: '',
      },
    });

    const result = await runRollback(ctx);

    expect(result.rolledBack).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'warn',
      }),
    );
  });

  it('keeps emergency rollback on worktree strategy safe', async () => {
    const { runEmergencyRollback } =
      await import('../../../../../src/core/grizzco/steps/rollback.js');
    restoreToShadowMock.mockResolvedValue(undefined);
    const ctx = createBaseCtx({
      workspace: {
        strategy: 'worktree',
        workPath: '/shadow-repo',
        baseRepoPath: '/main-repo',
      },
      changedFiles: ['target.ts'],
      verifyResult: { ok: false },
      astValid: false,
      isValid: true,
    });

    const result = await runEmergencyRollback(ctx);

    expect(result).toBe(ctx);
    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'warn',
      }),
    );
  });
});
