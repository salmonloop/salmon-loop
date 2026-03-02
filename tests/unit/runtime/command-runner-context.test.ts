import { describe, expect, it, mock } from 'bun:test';

mock.module('../../../src/core/runtime/spawn-command.js', () => ({
  spawnCommand: async () => ({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: 'local',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  }),
  spawnCommandLocal: async () => ({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: 'local',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  }),
  isCommandAvailable: async () => true,
  isCommandAvailableLocal: async () => true,
}));

describe('command runner context', () => {
  it('uses local spawnCommand outside context', async () => {
    const { spawnCommand } = await import('../../../src/core/runtime/process-runner.js');
    const result = await spawnCommand({ command: 'echo', args: ['hi'] });
    expect(result.stdout).toBe('local');
  });

  it('delegates spawnCommand inside withCommandRunner()', async () => {
    const { withCommandRunner } =
      await import('../../../src/core/runtime/command-runner-context.js');
    const { spawnCommand } = await import('../../../src/core/runtime/process-runner.js');

    const result = await withCommandRunner(
      {
        spawnCommand: async () => ({
          code: 0,
          signal: null,
          timedOut: false,
          stdout: 'acp',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
        isCommandAvailable: async () => true,
      },
      async () => spawnCommand({ command: 'echo', args: ['hi'] }),
    );

    expect(result.stdout).toBe('acp');
  });
});
