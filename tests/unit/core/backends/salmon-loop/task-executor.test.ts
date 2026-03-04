import { describe, expect, test } from 'bun:test';

import { createSalmonTaskExecutor } from '../../../../../src/core/backends/salmon-loop/task-executor.js';
import { text } from '../../../../../src/locales/index.js';

describe('salmon task executor', () => {
  test('maps a canonical task request into loop options', async () => {
    let observedOptions: any = null;
    const executor = createSalmonTaskExecutor({
      runLoop: async (options) => {
        observedOptions = options;
        return {
          success: true,
          reason: 'ok',
          reasonCode: 'SUCCESS',
          attempts: 1,
          logs: [],
        };
      },
    });

    const result = await executor.execute({
      id: 'task_1',
      capability: 'patch',
      state: 'accepted',
      request: { instruction: 'fix bug' },
      createdAt: '2026-02-28T00:00:00.000Z',
    });

    expect(result.state).toBe('completed');
    expect(observedOptions?.instruction).toBe('fix bug');
  });

  test('marks task as failed when loop execution fails', async () => {
    const executor = createSalmonTaskExecutor({
      runLoop: async () => ({
        success: false,
        reason: 'ERR_TECHNICAL_DETAILS_HIDDEN',
        reasonCode: 'LOOP_FAILED',
        errorCode: 'PREFLIGHT_NOT_GIT',
        attempts: 0,
        logs: [],
      }),
    });

    const result = await executor.execute({
      id: 'task_2',
      capability: 'patch',
      state: 'accepted',
      request: { instruction: 'fix bug' },
      createdAt: '2026-02-28T00:00:00.000Z',
    });

    expect(result.state).toBe('failed');
    expect(result.failure).toMatchObject({
      code: 'PREFLIGHT_NOT_GIT',
      message: text.errors.preflightNotGit,
      category: 'infrastructure',
    });
    expect(result.statusMessage).toBe(text.errors.preflightNotGit);
  });
});
