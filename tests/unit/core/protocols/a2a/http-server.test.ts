import { describe, expect, test } from 'bun:test';

import { A2AJsonRpcError } from '../../../../../src/core/protocols/a2a/server/jsonrpc-error.js';
import { createA2AJsonRpcHandler } from '../../../../../src/core/protocols/a2a/server/jsonrpc-handler.js';

describe('A2A JSON-RPC handler', () => {
  test('serves task submission requests', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return {
            id: 'task_1',
            state: 'accepted',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
          };
        },
      },
    });

    const result = await handler.handle({
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'fix bug' }],
        },
      },
      id: '1',
    });

    expect(result.id).toBe('1');
    expect(result.result.id).toBe('task_1');
    expect(result.result.status).toEqual({
      state: 'submitted',
      timestamp: '2026-02-28T00:00:00.000Z',
    });
  });

  test('serves task lookup requests', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async getTask() {
          return {
            id: 'task_1',
            state: 'completed',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
          };
        },
        async cancelTask() {
          return { id: 'task_1', state: 'cancelled' };
        },
      },
    });

    const result = await handler.handle({
      method: 'tasks/get',
      params: { id: 'task_1' },
      id: '2',
    });

    expect(result.id).toBe('2');
    expect(result.result.state).toBe('completed');
    expect(result.result.status).toEqual({
      state: 'completed',
      timestamp: '2026-02-28T00:00:00.000Z',
    });
  });

  test('serves task cancellation requests', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async getTask() {
          return { id: 'task_1', state: 'completed' };
        },
        async cancelTask() {
          return {
            id: 'task_1',
            state: 'cancelled',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
          };
        },
      },
    });

    const result = await handler.handle({
      method: 'tasks/cancel',
      params: { id: 'task_1' },
      id: '3',
    });

    expect(result.id).toBe('3');
    expect(result.result.state).toBe('cancelled');
    expect(result.result.status).toEqual({
      state: 'canceled',
      timestamp: '2026-02-28T00:00:00.000Z',
    });
  });

  test('raises typed invalid request errors', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
      },
    });

    await expect(handler.handle({ method: 123, id: null })).rejects.toMatchObject({
      code: -32600,
      status: 400,
      message: 'Invalid JSON-RPC request',
    } satisfies Partial<A2AJsonRpcError>);
  });

  test('raises typed task-not-found errors', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async getTask() {
          return null;
        },
      },
    });

    await expect(
      handler.handle({
        method: 'tasks/get',
        params: { id: 'missing-task' },
        id: '4',
      }),
    ).rejects.toMatchObject({
      code: -32004,
      status: 404,
      message: 'Task not found: missing-task',
    } satisfies Partial<A2AJsonRpcError>);
  });
});
