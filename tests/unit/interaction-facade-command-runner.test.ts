import { describe, expect, it } from 'bun:test';

describe('createInteractionFacade', () => {
  it('passes commandRunner to executeTask', async () => {
    const { createInteractionFacade } =
      await import('../../src/core/interaction/orchestration/facade.js');

    let resolveSeen: (value: unknown) => void = () => {};
    const seen = new Promise((resolve) => {
      resolveSeen = resolve;
    });

    const runner = {
      spawnCommand: async () => ({
        code: 0,
        signal: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
      isCommandAvailable: async () => true,
    };

    const facade = createInteractionFacade({
      executeTask: async (task, options) => {
        resolveSeen(options?.commandRunner);
        return { ...task, state: 'completed' };
      },
    });

    await facade.createTask({
      capability: 'patch',
      request: { instruction: 'x' },
      commandRunner: runner as any,
    } as any);

    await expect(seen).resolves.toBe(runner);
  });
});
