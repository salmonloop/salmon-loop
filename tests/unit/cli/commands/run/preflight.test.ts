import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  loadPlugins: vi.fn(async () => {}),
  detectNodeRuntimeProfile: vi.fn(),
  resolveScriptCommand: vi.fn(),
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  spawnSync: hoisted.spawnSync,
}));

vi.mock('../../../../../src/core/plugin/loader.js', () => ({
  PluginLoader: { loadPlugins: hoisted.loadPlugins },
}));

vi.mock('../../../../../src/core/target-runtime/index.js', () => ({
  detectNodeRuntimeProfile: hoisted.detectNodeRuntimeProfile,
  resolveScriptCommand: hoisted.resolveScriptCommand,
}));

vi.mock('../../../../../src/core/observability/logger.js', () => ({
  logger: hoisted.logger,
}));

describe('runPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.spawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      error: undefined,
    });
  });

  it('skips validation when runtime profile is not detected', async () => {
    hoisted.detectNodeRuntimeProfile.mockResolvedValue(undefined);

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    await runPreflight({ repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.loadPlugins).toHaveBeenCalledWith('/tmp/repo');
    expect(hoisted.spawnSync).not.toHaveBeenCalled();
    expect(hoisted.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('runs lint and test via resolved command specs', async () => {
    hoisted.detectNodeRuntimeProfile.mockResolvedValue({
      packageManager: 'pnpm',
      source: 'lockfile',
      scripts: { lint: 'eslint .', test: 'vitest run' },
    });
    hoisted.resolveScriptCommand.mockImplementation((_profile: unknown, scriptName: string) => {
      if (scriptName === 'lint') {
        return {
          packageManager: 'pnpm',
          scriptName: 'lint',
          command: 'pnpm',
          args: ['run', 'lint'],
          shellCommand: 'pnpm run lint',
        };
      }
      if (scriptName === 'test') {
        return {
          packageManager: 'pnpm',
          scriptName: 'test',
          command: 'pnpm',
          args: ['run', 'test'],
          shellCommand: 'pnpm run test',
        };
      }
      return undefined;
    });

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    await runPreflight({ repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.spawnSync).toHaveBeenCalledTimes(2);
    expect(hoisted.spawnSync).toHaveBeenNthCalledWith(
      1,
      'pnpm',
      ['run', 'lint'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(hoisted.spawnSync).toHaveBeenNthCalledWith(
      2,
      'pnpm',
      ['run', 'test'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(hoisted.logger.success).toHaveBeenCalledTimes(1);
  });

  it('continues when test script fails', async () => {
    hoisted.detectNodeRuntimeProfile.mockResolvedValue({
      packageManager: 'npm',
      source: 'default',
      scripts: { lint: 'eslint .', test: 'vitest run' },
    });
    hoisted.resolveScriptCommand.mockImplementation((_profile: unknown, scriptName: string) => {
      if (scriptName === 'lint') {
        return {
          packageManager: 'npm',
          scriptName: 'lint',
          command: 'npm',
          args: ['run', 'lint'],
          shellCommand: 'npm run lint',
        };
      }
      if (scriptName === 'test') {
        return {
          packageManager: 'npm',
          scriptName: 'test',
          command: 'npm',
          args: ['run', 'test'],
          shellCommand: 'npm run test',
        };
      }
      return undefined;
    });

    hoisted.spawnSync
      .mockReturnValueOnce({
        stdout: '',
        stderr: '',
        status: 0,
        error: undefined,
      })
      .mockReturnValueOnce({
        stdout: '',
        stderr: 'tests failed',
        status: 1,
        error: undefined,
      });

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    await runPreflight({ repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.logger.warn).toHaveBeenCalledTimes(1);
    expect(hoisted.logger.success).toHaveBeenCalledTimes(1);
  });
});
