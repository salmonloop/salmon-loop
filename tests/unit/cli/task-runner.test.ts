import { describe, expect, test } from 'bun:test';

import { createCliTaskRunner } from '../../../src/interfaces/cli/task-runner.js';

describe('cli task runner', () => {
  test('delegates execution to the shared interaction facade', async () => {
    let called = false;

    const runner = createCliTaskRunner({
      facade: {
        async createTask() {
          called = true;
          return { id: 'task_1', state: 'accepted' };
        },
      },
    });

    await runner.run({ capability: 'patch', instruction: 'fix bug' });

    expect(called).toBe(true);
  });
});
