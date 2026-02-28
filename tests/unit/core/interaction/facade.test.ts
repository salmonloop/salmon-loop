import { describe, expect, test } from 'bun:test';

import { createInteractionFacade } from '../../../../src/core/interaction/orchestration/index.js';

describe('interaction facade', () => {
  test('creates tasks in accepted state before execution', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const created = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    expect(created.state).toBe('accepted');

    const loaded = await facade.getTask(created.id);
    expect(loaded?.id).toBe(created.id);
  });
});
