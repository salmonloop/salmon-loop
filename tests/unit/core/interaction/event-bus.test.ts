import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../../../src/core/interaction/events/bus.js';

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
});
