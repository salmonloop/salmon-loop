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

function createStubTransport(responses: unknown[], stream?: ReadableStream<Uint8Array>) {
  let index = 0;
  return {
    async request() {
      return responses[index++];
    },
    async subscribe() {
      return new Response(
        stream ??
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
    await client.subscribeTask('task_3', (task) => updates.push(task.state), {
      autoSyncOnEnd: false,
    });

    expect(updates).toEqual(['completed']);
  });

  test('syncs latest snapshot after stream ends by default', async () => {
    const client = createA2AClient({
      transport: createStubTransport(
        [
          {
            jsonrpc: '2.0',
            id: '4',
            result: {
              id: 'task_4',
              state: 'failed',
              status: { state: 'failed', timestamp: '2026-02-28T00:00:00.000Z' },
              metadata: { capability: 'patch' },
            },
          },
        ],
        buildSseStream([
          'id: 1\n',
          'event: task.completed\n',
          'data: {"taskId":"task_4","type":"task.completed","state":"completed"}\n\n',
        ]),
      ),
    });

    const updates: string[] = [];
    await client.subscribeTask('task_4', (task) => updates.push(task.state));

    expect(updates).toEqual(['completed', 'failed']);
  });

  test('skips auto sync when disabled', async () => {
    const client = createA2AClient({
      transport: createStubTransport(
        [
          {
            jsonrpc: '2.0',
            id: '5',
            result: {
              id: 'task_5',
              state: 'failed',
              status: { state: 'failed', timestamp: '2026-02-28T00:00:00.000Z' },
              metadata: { capability: 'patch' },
            },
          },
        ],
        buildSseStream([
          'id: 1\n',
          'event: task.completed\n',
          'data: {"taskId":"task_5","type":"task.completed","state":"completed"}\n\n',
        ]),
      ),
    });

    const updates: string[] = [];
    await client.subscribeTask('task_5', (task) => updates.push(task.state), {
      autoSyncOnEnd: false,
    });

    expect(updates).toEqual(['completed']);
  });

  test('emits sync callback for auto sync snapshot', async () => {
    const client = createA2AClient({
      transport: createStubTransport(
        [
          {
            jsonrpc: '2.0',
            id: '6',
            result: {
              id: 'task_6',
              state: 'failed',
              status: { state: 'failed', timestamp: '2026-02-28T00:00:00.000Z' },
              metadata: { capability: 'patch' },
            },
          },
        ],
        buildSseStream([
          'id: 1\n',
          'event: task.completed\n',
          'data: {"taskId":"task_6","type":"task.completed","state":"completed"}\n\n',
        ]),
      ),
    });

    const syncUpdates: string[] = [];
    await client.subscribeTask('task_6', () => undefined, {
      onSync: (task) => syncUpdates.push(task.state),
    });

    expect(syncUpdates).toEqual(['failed']);
  });

  test('requests replay when sinceEventId is provided', async () => {
    const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = createA2AClient({
      transport: {
        async request(payload) {
          seen.push({ method: payload.method, params: payload.params ?? {} });
          return {
            jsonrpc: '2.0',
            id: '7',
            result: {
              id: 'task_7',
              state: 'completed',
              status: { state: 'completed', timestamp: '2026-02-28T00:00:00.000Z' },
              metadata: { capability: 'patch' },
            },
          };
        },
        async subscribe() {
          return new Response('', { headers: { 'content-type': 'text/event-stream' } });
        },
      },
    });

    await client.syncTask('task_7', { sinceEventId: '10' });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'tasks/get',
      params: { id: 'task_7', sinceEventId: '10' },
    });
  });

  test('applies replay events returned from syncTask', async () => {
    const client = createA2AClient({
      transport: {
        async request() {
          return {
            jsonrpc: '2.0',
            id: '8',
            result: {
              id: 'task_8',
              state: 'running',
              status: { state: 'working', timestamp: '2026-02-28T00:00:00.000Z' },
              metadata: { capability: 'patch' },
              events: [{ id: '11', type: 'task.completed', taskId: 'task_8', state: 'completed' }],
            },
          };
        },
        async subscribe() {
          return new Response('', { headers: { 'content-type': 'text/event-stream' } });
        },
      },
    });

    const task = await client.syncTask('task_8', { sinceEventId: '10' });

    expect(task.state).toBe('completed');
  });
});
