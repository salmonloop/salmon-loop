import { describe, expect, test } from 'bun:test';

import { createA2AJsonRpcHandler } from '../../../../../src/core/protocols/a2a/server/jsonrpc-handler.js';

describe('A2A JSON-RPC handler', () => {
  test('serves task submission requests', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
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
  });

  test('serves task lookup requests', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async getTask() {
          return { id: 'task_1', state: 'completed' };
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
          return { id: 'task_1', state: 'cancelled' };
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
  });
});
