import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { runCommandMock } = (() => ({
  runCommandMock: mock(),
}))();

mock.module('../../../../../src/core/verification/runner.js', () => ({
  runCommand: runCommandMock,
}));

describe('runPrepareDeps', () => {
  beforeEach(() => {
    mock.clearAllMocks();
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
