import { beforeEach, describe, expect, it, mock } from 'bun:test';

const {
  runCommandMock,
  detectNodeRuntimeProfileMock,
  resolveNodeWorktreePrepareCommandMock,
  recordAuditEventMock,
} = (() => ({
  runCommandMock: mock(),
  detectNodeRuntimeProfileMock: mock(),
  resolveNodeWorktreePrepareCommandMock: mock(),
  recordAuditEventMock: mock(),
}))();

mock.module('../../../../../src/core/verification/runner.js', () => ({
  runCommand: runCommandMock,
}));

mock.module('../../../../../src/core/target-runtime/index.js', () => ({
  detectNodeRuntimeProfile: detectNodeRuntimeProfileMock,
  resolveNodeWorktreePrepareCommand: resolveNodeWorktreePrepareCommandMock,
}));

mock.module('../../../../../src/core/observability/audit-trail.js', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

describe('runPrepareDeps', () => {
  beforeEach(() => {
    mock.restore();
  });

  function createCtx(overrides: Record<string, unknown> = {}) {
    return {
      options: {
        worktreePrepare: 'bun install --frozen-lockfile',
      },
      workspace: {
        strategy: 'worktree',
        workPath: '/tmp/worktree',
      },
      emit: mock(),
      ...overrides,
    } as any;
  }

  it('runs worktree prepare command in worktree mode', async () => {
    runCommandMock.mockResolvedValueOnce({
      ok: true,
      output: 'ok',
      exitCode: 0,
    });

    const { runPrepareDeps } =
      await import('../../../../../src/core/grizzco/steps/prepare-deps.js');
    const ctx = createCtx();

    const result = await runPrepareDeps(ctx);

    expect(result).toBe(ctx);
    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith(
      '/tmp/worktree',
      'bun install --frozen-lockfile',
      expect.any(Number),
      undefined,
      undefined,
    );
  });

  it('skips when worktreePrepare command is not set', async () => {
    const { runPrepareDeps } =
      await import('../../../../../src/core/grizzco/steps/prepare-deps.js');
    const ctx = createCtx({
      options: {
        worktreePrepare: undefined,
      },
    });

    const result = await runPrepareDeps(ctx);

    expect(result).toBe(ctx);
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it('auto-detects prepare command when worktreePrepare is missing', async () => {
    detectNodeRuntimeProfileMock.mockResolvedValueOnce({
      packageManager: 'bun',
      source: 'lockfile',
      scripts: {},
    });
    resolveNodeWorktreePrepareCommandMock.mockReturnValueOnce('bun install --frozen-lockfile');
    runCommandMock.mockResolvedValueOnce({
      ok: true,
      output: 'ok',
      exitCode: 0,
    });

    const { runPrepareDeps } =
      await import('../../../../../src/core/grizzco/steps/prepare-deps.js');
    const ctx = createCtx({
      options: {
        worktreePrepare: undefined,
      },
    });

    const result = await runPrepareDeps(ctx);

    expect(result).toBe(ctx);
    expect(detectNodeRuntimeProfileMock).toHaveBeenCalledWith('/tmp/worktree');
    expect(resolveNodeWorktreePrepareCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith(
      '/tmp/worktree',
      'bun install --frozen-lockfile',
      expect.any(Number),
      undefined,
      undefined,
    );
  });

  it('skips when strategy is not worktree', async () => {
    const { runPrepareDeps } =
      await import('../../../../../src/core/grizzco/steps/prepare-deps.js');
    const ctx = createCtx({
      workspace: {
        strategy: 'direct',
        workPath: '/repo',
      },
    });

    const result = await runPrepareDeps(ctx);

    expect(result).toBe(ctx);
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'prepare_deps.skipped',
      expect.objectContaining({ reason: 'non_worktree' }),
      expect.objectContaining({ phase: 'PREPARE_DEPS' }),
    );
  });

  it('records skipped reason when no prepare command can be resolved', async () => {
    detectNodeRuntimeProfileMock.mockResolvedValueOnce(undefined);

    const { runPrepareDeps } =
      await import('../../../../../src/core/grizzco/steps/prepare-deps.js');
    const ctx = createCtx({
      options: {
        worktreePrepare: undefined,
      },
    });

    const result = await runPrepareDeps(ctx);

    expect(result).toBe(ctx);
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'prepare_deps.skipped',
      expect.objectContaining({ reason: 'no_command' }),
      expect.objectContaining({ phase: 'PREPARE_DEPS' }),
    );
  });

  it('throws DEPENDENCY_ERROR when prepare command fails', async () => {
    runCommandMock.mockResolvedValueOnce({
      ok: false,
      output: 'install failed',
      exitCode: 1,
    });

    const { runPrepareDeps } =
      await import('../../../../../src/core/grizzco/steps/prepare-deps.js');
    const ctx = createCtx();

    await expect(runPrepareDeps(ctx)).rejects.toMatchObject({
      code: 'DEPENDENCY_ERROR',
    });
  });
});
