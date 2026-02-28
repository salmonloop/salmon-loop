import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../../../src/core/interaction/events/bus.js';
import { createInteractionFacade } from '../../../../src/core/interaction/orchestration/index.js';

describe('task event bus', () => {
  test('publishes lifecycle events in order', () => {
    const seen: string[] = [];
    const bus = createTaskEventBus();

    bus.subscribe((event) => {
      seen.push(event.type);
    });

    bus.publish({ type: 'task.accepted', taskId: 'task_1' });
    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    expect(seen).toEqual(['task.accepted', 'task.completed']);
  });

  test('includes failure details in lifecycle events', async () => {
    const bus = createTaskEventBus();
    const seen: Array<{
      type: string;
      attempt?: number;
      failure?: { category?: string; code?: string };
    }> = [];
    bus.subscribe((event) => {
      seen.push({ type: event.type, attempt: event.attempt, failure: event.failure });
    });

    const facade = createInteractionFacade({
      eventBus: bus,
      executeTask: async (task) => ({ ...task, state: 'running' }),
    });

    const created = await facade.createTask({
      capability: 'patch',
      request: { instruction: 'fail me' },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    await facade.failTask(created.id, {
      code: 'VERIFY_FAILED',
      category: 'verification',
      message: 'Verification failed',
      retryable: true,
    });

    expect(seen).toContainEqual({
      type: 'task.failed',
      attempt: 1,
      failure: { category: 'verification', code: 'VERIFY_FAILED' },
    });
  });

  test('supports unsubscribing listeners', () => {
    const seen: string[] = [];
    const bus = createTaskEventBus();

    const unsubscribe = bus.subscribe((event) => {
      seen.push(event.type);
    });

    unsubscribe();
    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    expect(seen).toEqual([]);
  });

  test('assigns monotonically increasing ids even when callers provide ids', () => {
    const seen: string[] = [];
    const bus = createTaskEventBus();

    bus.subscribe((event) => {
      if (event.id) seen.push(event.id);
    });

    bus.publish({ id: '10', type: 'task.accepted', taskId: 'task_1' });
    bus.publish({ id: '2', type: 'task.completed', taskId: 'task_1' });

    expect(seen).toEqual(['10', '11']);
  });

  test('lists task events with limit after a given id', () => {
    const bus = createTaskEventBus();

    bus.publish({ type: 'task.accepted', taskId: 'task_1' });
    bus.publish({ type: 'task.running', taskId: 'task_1' });
    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    const events = bus.list('task_1', { afterId: '1', limit: 1 });

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('2');
  });
});
