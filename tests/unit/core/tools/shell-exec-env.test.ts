import { beforeEach, describe, expect, it } from 'bun:test';

const hoisted = (() => ({
  execa: mock(),
}))();

mock.module('execa', () => ({
  execa: hoisted.execa,
}));

describe('executeShellExec environment injection', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    hoisted.execa.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });
  });

  it('injects SALMONLOOP_* runtime variables and strips framework secrets', async () => {
    process.env.SALMONLOOP_API_KEY = 'secret123';
    process.env.S8P_API_KEY = 'secret456';

    const { executeShellExec } = await import('../../../../src/core/tools/builtin/shell.js');

    await executeShellExec(
      { command: 'echo hi' },
      {
        repoRoot: '/repo',
        worktreeRoot: '/repo/.shadow',
        attemptId: 7,
        dryRun: false,
        env: { CUSTOM_ENV: '1' },
      },
    );

    expect(hoisted.execa).toHaveBeenCalledTimes(1);
    const execaCall = hoisted.execa.mock.calls[0];
    const envArg = execaCall[2].env;

    expect(envArg.SALMONLOOP_API_KEY).toBeUndefined();
    expect(envArg.S8P_API_KEY).toBeUndefined();

    expect(hoisted.execa).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: '/repo/.shadow',
        env: expect.objectContaining({
          CUSTOM_ENV: '1',
          SALMONLOOP_REPO_ROOT: '/repo',
          SALMONLOOP_WORKTREE_ROOT: '/repo/.shadow',
          SALMONLOOP_ATTEMPT_ID: '7',
        }),
      }),
    );

    delete process.env.SALMONLOOP_API_KEY;
    delete process.env.S8P_API_KEY;
  });

  it('keeps authorization summary cwd semantics unchanged', async () => {
    const { shellExecSpec } = await import('../../../../src/core/tools/builtin/shell.js');

    await expect(
      shellExecSpec.summarizeArgsForAuthorization?.({ command: 'echo hi' }, {
        repoRoot: '/repo',
        worktreeRoot: '/repo/.shadow',
      } as any),
    ).resolves.toBe('command="echo hi" cwd="/repo/.shadow"');

    await expect(
      shellExecSpec.summarizeArgsForAuthorization?.({ command: 'echo hi' }, {
        repoRoot: '/repo',
        worktreeRoot: undefined,
      } as any),
    ).resolves.toBe('command="echo hi" cwd="/repo"');
  });
});
