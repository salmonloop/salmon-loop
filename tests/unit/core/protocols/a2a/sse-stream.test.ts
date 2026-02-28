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

  test('replays missed task events after last-event-id before streaming new ones', async () => {
    const bus = createTaskEventBus();
    const source = createSseEventSource(bus);

    bus.publish({ type: 'task.accepted', taskId: 'task_1' });
    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    const response = source.open(
      'task_1',
      new Request('https://example.com/tasks/task_1/subscribe', {
        headers: { 'last-event-id': '1' },
      }),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const replayChunk = await reader!.read();
    const replayText = new TextDecoder().decode(replayChunk.value);

    expect(replayText).toContain('id: 2');
    expect(replayText).toContain('event: task.completed');

    bus.publish({ type: 'task.cancelled', taskId: 'task_1' });

    const liveChunk = await reader!.read();
    const liveText = new TextDecoder().decode(liveChunk.value);

    expect(liveText).toContain('id: 3');
    expect(liveText).toContain('event: task.cancelled');
  });

  test('limits replay volume according to replay window policy', async () => {
    const bus = createTaskEventBus();
    const source = createSseEventSource(bus, { maxReplayEvents: 2 });

    bus.publish({ type: 'task.accepted', taskId: 'task_1' });
    bus.publish({ type: 'task.running', taskId: 'task_1' });
    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    const response = source.open(
      'task_1',
      new Request('https://example.com/tasks/task_1/subscribe'),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const firstChunk = await reader!.read();
    const firstText = new TextDecoder().decode(firstChunk.value);
    expect(firstText).toContain('id: 2');
    expect(firstText).toContain('event: task.running');

    const secondChunk = await reader!.read();
    const secondText = new TextDecoder().decode(secondChunk.value);
    expect(secondText).toContain('id: 3');
    expect(secondText).toContain('event: task.completed');
  });

  test('respects replay limit query parameter', async () => {
    const bus = createTaskEventBus();
    const source = createSseEventSource(bus);

    bus.publish({ type: 'task.accepted', taskId: 'task_1' });
    bus.publish({ type: 'task.running', taskId: 'task_1' });
    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    const response = source.open(
      'task_1',
      new Request('https://example.com/tasks/task_1/subscribe?replayLimit=1', {
        headers: { 'last-event-id': '1' },
      }),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const replayChunk = await reader!.read();
    const replayText = new TextDecoder().decode(replayChunk.value);
    expect(replayText).toContain('id: 2');
    expect(replayText).toContain('event: task.running');

    bus.publish({ type: 'task.cancelled', taskId: 'task_1' });

    const nextChunk = await reader!.read();
    const nextText = new TextDecoder().decode(nextChunk.value);
    expect(nextText).toContain('id: 4');
    expect(nextText).toContain('event: task.cancelled');
  });

  test('emits heartbeat comments when configured', async () => {
    let heartbeatTick: (() => void) | undefined;
    const source = createSseEventSource(undefined, {
      heartbeatIntervalMs: 10,
      setInterval: ((callback: TimerHandler) => {
        if (typeof callback === 'function') {
          heartbeatTick = () => callback();
        }
        return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
      }) as unknown as typeof globalThis.setInterval,
      clearInterval: () => {},
    });

    const response = source.open(
      'task_1',
      new Request('https://example.com/tasks/task_1/subscribe'),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    await reader!.read();
    heartbeatTick?.();

    const chunk = await reader!.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain(': heartbeat');
  });
});
