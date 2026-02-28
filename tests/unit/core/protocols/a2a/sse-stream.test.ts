import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../../../../src/core/interaction/events/bus.js';
import { createSseEventSource } from '../../../../../src/core/protocols/a2a/server/sse-stream.js';

describe('A2A SSE event source', () => {
  test('streams task events from the task event bus', async () => {
    const bus = createTaskEventBus();
    const source = createSseEventSource(bus);

    const response = source.open('task_1');
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    const chunk = await reader!.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).toContain('event: task.completed');
    expect(text).toContain('"taskId":"task_1"');
  });
});
