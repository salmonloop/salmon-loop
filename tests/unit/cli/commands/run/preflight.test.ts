import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { clearLogger, setLogger } from '../../../../../src/core/observability/logger.js';

const hoisted = (() => ({
  spawnCommand: mock(),
  loadPlugins: mock(async () => {}),
  detectNodeRuntimeProfile: mock(),
  resolveScriptCommand: mock(),
  logger: {
    log: mock(),
    debug: mock(),
    warn: mock(),
    success: mock(),
    error: mock(),
    audit: mock(),
  },
}))();

mock.module('../../../../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: hoisted.spawnCommand,
}));

mock.module('../../../../../src/core/plugin/loader.js', () => ({
  PluginLoader: { loadPlugins: hoisted.loadPlugins },
}));

mock.module('../../../../../src/core/target-runtime/index.js', () => ({
  detectNodeRuntimeProfile: hoisted.detectNodeRuntimeProfile,
  resolveScriptCommand: hoisted.resolveScriptCommand,
}));

describe('runPreflight', () => {
  afterAll(() => {
    mock.restore();
    clearLogger();
  });

  beforeEach(() => {
    mock.clearAllMocks();
    setLogger(hoisted.logger as any);
    hoisted.spawnCommand.mockResolvedValue({
      code: 0,
      signal: null,
      timedOut: false,
      error: undefined,
      failure: undefined,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it('skips validation when runtime profile is not detected', async () => {
    hoisted.detectNodeRuntimeProfile.mockResolvedValue(undefined);

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    const languagePlugins = {} as any;
    await runPreflight({ languagePlugins, repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.loadPlugins).toHaveBeenCalledWith(languagePlugins, '/tmp/repo');
    expect(hoisted.spawnCommand).not.toHaveBeenCalled();
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
    const languagePlugins = {} as any;
    await runPreflight({ languagePlugins, repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.spawnCommand).toHaveBeenCalledTimes(2);
    expect(hoisted.spawnCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: 'pnpm',
        args: ['run', 'lint'],
        cwd: '/tmp/repo',
      }),
    );
    expect(hoisted.spawnCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: 'pnpm',
        args: ['run', 'test'],
        cwd: '/tmp/repo',
      }),
    );
    expect(hoisted.logger.success).toHaveBeenCalledTimes(1);
  });

  it('passes no-color environment to validation commands in headless mode', async () => {
    hoisted.detectNodeRuntimeProfile.mockResolvedValue({
      packageManager: 'pnpm',
      source: 'lockfile',
      scripts: { lint: 'eslint .' },
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
      return undefined;
    });

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    const languagePlugins = {} as any;
    await runPreflight({
      languagePlugins,
      repoPath: '/tmp/repo',
      validate: true,
      useGui: false,
      headlessOutput: true,
    });

    expect(hoisted.spawnCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          NO_COLOR: '1',
          FORCE_COLOR: '0',
        }),
      }),
    );
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

    hoisted.spawnCommand
      .mockResolvedValueOnce({
        code: 0,
        signal: null,
        timedOut: false,
        error: undefined,
        failure: undefined,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      })
      .mockResolvedValueOnce({
        code: 1,
        signal: null,
        timedOut: false,
        error: undefined,
        failure: {
          kind: 'nonzero_exit',
          message: 'Command exited with code 1',
          command: 'npm',
          args: ['run', 'test'],
          exitCode: 1,
          signal: null,
        },
        stdout: '',
        stderr: 'tests failed',
        stdoutTruncated: false,
        stderrTruncated: false,
      });

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    const languagePlugins = {} as any;
    await runPreflight({ languagePlugins, repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.logger.warn).toHaveBeenCalledTimes(2);
    expect(hoisted.logger.success).toHaveBeenCalledTimes(1);
  });

  it('fails on test script failure when preflight policy is strict', async () => {
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
    hoisted.spawnCommand
      .mockResolvedValueOnce({
        code: 0,
        signal: null,
        timedOut: false,
        error: undefined,
        failure: undefined,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      })
      .mockResolvedValueOnce({
        code: 1,
        signal: null,
        timedOut: false,
        error: undefined,
        failure: {
          kind: 'nonzero_exit',
          message: 'Command exited with code 1',
          command: 'npm',
          args: ['run', 'test'],
          exitCode: 1,
          signal: null,
        },
        stdout: '',
        stderr: 'tests failed',
        stdoutTruncated: false,
        stderrTruncated: false,
      });

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    const languagePlugins = {} as any;
    await runPreflight({
      languagePlugins,
      repoPath: '/tmp/repo',
      validate: true,
      useGui: false,
      preflightPolicy: 'strict',
    });

    expect(hoisted.logger.warn).toHaveBeenCalledTimes(0);
    expect(hoisted.logger.success).toHaveBeenCalledTimes(0);
    expect(hoisted.logger.error).toHaveBeenCalled();
    expect(hoisted.logger.audit).toHaveBeenCalledTimes(1);
  });

  it('logs timeout failure classification for lint', async () => {
    hoisted.detectNodeRuntimeProfile.mockResolvedValue({
      packageManager: 'npm',
      source: 'default',
      scripts: { lint: 'eslint .' },
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
      return undefined;
    });
    hoisted.spawnCommand.mockResolvedValueOnce({
      code: null,
      signal: 'SIGTERM',
      timedOut: true,
      error: undefined,
      failure: {
        kind: 'timeout',
        message: 'Command timed out',
        command: 'npm',
        args: ['run', 'lint'],
        exitCode: null,
        signal: 'SIGTERM',
      },
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    const languagePlugins = {} as any;
    await runPreflight({ languagePlugins, repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.logger.audit).toHaveBeenCalledTimes(1);
    expect(hoisted.logger.error).toHaveBeenCalled();
    expect(hoisted.logger.success).toHaveBeenCalledTimes(0);
  });

  it('logs output truncation classification for lint', async () => {
    hoisted.detectNodeRuntimeProfile.mockResolvedValue({
      packageManager: 'npm',
      source: 'default',
      scripts: { lint: 'eslint .' },
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
      return undefined;
    });
    hoisted.spawnCommand.mockResolvedValueOnce({
      code: 0,
      signal: null,
      timedOut: false,
      error: undefined,
      failure: undefined,
      stdout: 'x'.repeat(16),
      stderr: '',
      stdoutTruncated: true,
      stderrTruncated: false,
    });

    const { runPreflight } = await import('../../../../../src/cli/commands/run/preflight.js');
    const languagePlugins = {} as any;
    await runPreflight({ languagePlugins, repoPath: '/tmp/repo', validate: true, useGui: false });

    expect(hoisted.logger.audit).toHaveBeenCalledTimes(1);
    expect(hoisted.logger.error).toHaveBeenCalled();
    expect(hoisted.logger.success).toHaveBeenCalledTimes(0);
  });
});
