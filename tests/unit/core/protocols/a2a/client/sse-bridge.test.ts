import { describe, expect, test } from 'bun:test';

import { createA2ASseSubscriptionBridge } from '../../../../../../src/core/protocols/a2a/client/sse-bridge.js';

function buildSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('A2A SSE bridge', () => {
  test('parses SSE events into task events', async () => {
    const bridge = createA2ASseSubscriptionBridge();
    const events: Array<{ type: string; taskId: string }> = [];

    await bridge.consumeStream(
      buildSseStream([
        'id: 1\n',
        'event: task.completed\n',
        'data: {"taskId":"task_1","type":"task.completed"}\n\n',
      ]),
      (event) => events.push({ type: event.type, taskId: event.taskId }),
    );

    expect(events).toEqual([{ type: 'task.completed', taskId: 'task_1' }]);
  });
});
