import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../../../src/core/interaction/events/bus.js';
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

  test('updates stored task after execution completes', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const created = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const loaded = await facade.getTask(created.id);
    expect(loaded?.state).toBe('completed');
  });

  test('cancels an existing task', async () => {
    const facade = createInteractionFacade({
      executeTask: async (task) => task,
    });

    const created = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    const cancelled = await facade.cancelTask(created.id);

    expect(cancelled?.state).toBe('cancelled');
  });

  test('publishes accepted, completed, and cancelled events to the task bus', async () => {
    const bus = createTaskEventBus();
    const seen: string[] = [];
    bus.subscribe((event) => {
      seen.push(event.type);
    });

    const facade = createInteractionFacade({
      eventBus: bus,
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });

    const created = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fix bug' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await facade.cancelTask(created.id);

    expect(seen).toEqual(['task.accepted', 'task.completed', 'task.cancelled']);
  });
});
