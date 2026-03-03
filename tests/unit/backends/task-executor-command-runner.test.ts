import { describe, expect, it, mock } from 'bun:test';

mock.module('../../../src/core/runtime/spawn-command.js', () => ({
  spawnCommandLocal: async () => ({
    code: 0,
    signal: null,
    timedOut: false,
    stdout: 'local',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  }),
  isCommandAvailableLocal: async () => true,
}));

describe('createSalmonTaskExecutor', () => {
  it('runs loop inside provided commandRunner context', async () => {
    const { createSalmonTaskExecutor } =
      await import('../../../src/core/backends/salmon-loop/task-executor.js');
    const { spawnCommand } = await import('../../../src/core/runtime/process-runner.js');

    let observedStdout = '';
    const executor = createSalmonTaskExecutor({
      runLoop: async () => {
        const result = await spawnCommand({ command: 'echo', args: ['hi'] });
        observedStdout = result.stdout;
        return {
          success: true,
          reason: 'ok',
          reasonCode: 'SUCCESS',
          attempts: 1,
          logs: [],
        };
      },
    });

    await executor.execute(
      {
        id: 'task_1',
        capability: 'patch',
        state: 'accepted',
        request: { instruction: 'x' },
        createdAt: new Date().toISOString(),
        attempt: 1,
      },
      {
        commandRunner: {
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
      } as any,
    );

    expect(observedStdout).toBe('acp');
  });
});
