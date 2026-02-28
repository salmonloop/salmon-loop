import { describe, expect, test } from 'bun:test';

import { createA2AClient } from '../../../../../../src/core/protocols/a2a/client/client.js';

function buildSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function createStubTransport(responses: unknown[]) {
  let index = 0;
  return {
    async request() {
      return responses[index++];
    },
    async subscribe() {
      return new Response(
        buildSseStream([
          'id: 1\n',
          'event: task.completed\n',
          'data: {"taskId":"task_3","type":"task.completed","state":"completed"}\n\n',
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  };
}

describe('A2A client', () => {
  test('starts tasks and syncs snapshot', async () => {
    const client = createA2AClient({
      transport: createStubTransport([
        {
          jsonrpc: '2.0',
          id: '1',
          result: {
            id: 'task_1',
            state: 'accepted',
            status: { state: 'submitted', timestamp: '2026-02-28T00:00:00.000Z' },
            metadata: { capability: 'patch' },
          },
        },
      ]),
    });

    const task = await client.startTask({ instruction: 'fix bug' });

    expect(task.id).toBe('task_1');
    expect(task.request.instruction).toBe('fix bug');
  });

  test('syncs remote task by fetching latest snapshot', async () => {
    const client = createA2AClient({
      transport: createStubTransport([
        {
          jsonrpc: '2.0',
          id: '2',
          result: {
            id: 'task_2',
            state: 'completed',
            status: { state: 'completed', timestamp: '2026-02-28T00:00:00.000Z' },
            metadata: { capability: 'patch' },
          },
        },
      ]),
    });

    const task = await client.syncTask('task_2');

    expect(task.state).toBe('completed');
  });

  test('subscribes to SSE updates and applies them', async () => {
    const client = createA2AClient({
      transport: createStubTransport([
        {
          jsonrpc: '2.0',
          id: '3',
          result: {
            id: 'task_3',
            state: 'accepted',
            status: { state: 'submitted', timestamp: '2026-02-28T00:00:00.000Z' },
            metadata: { capability: 'patch' },
          },
        },
      ]),
    });

    await client.startTask({ instruction: 'seed' });

    const updates: string[] = [];
    await client.subscribeTask('task_3', (task) => updates.push(task.state));

    expect(updates).toEqual(['completed']);
  });
});
