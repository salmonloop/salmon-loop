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
    expect(result.result).toMatchObject({
      id: 'task_1',
    });
    expect('items' in result.result).toBe(false);
    const taskResult = result.result as Exclude<typeof result.result, { items: unknown }>;
    expect(taskResult.status).toEqual({
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
    expect('items' in result.result).toBe(false);
    const taskResult = result.result as Exclude<typeof result.result, { items: unknown }>;
    expect(taskResult.state).toBe('completed');
    expect(taskResult.status).toEqual({
      state: 'completed',
      timestamp: '2026-02-28T00:00:00.000Z',
    });
  });

  test('projects artifacts and input-required payloads on task lookup', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async getTask() {
          return {
            id: 'task_1',
            state: 'awaiting_input',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
            statusMessage: 'Need approval to continue',
            inputRequired: {
              type: 'confirmation',
              prompt: 'Approve patch application?',
            },
            artifacts: [
              {
                id: 'artifact_1',
                name: 'patch.diff',
                kind: 'diff',
                mimeType: 'text/x-diff',
              },
            ],
          };
        },
      },
    });

    const result = await handler.handle({
      method: 'tasks/get',
      params: { id: 'task_1' },
      id: '2a',
    });

    expect('items' in result.result).toBe(false);
    const taskResult = result.result as Exclude<typeof result.result, { items: unknown }>;
    expect(taskResult.status).toEqual({
      state: 'input-required',
      timestamp: '2026-02-28T00:00:00.000Z',
      message: 'Need approval to continue',
    });
    expect(taskResult.requiredAction).toEqual({
      type: 'confirmation',
      prompt: 'Approve patch application?',
    });
    expect(taskResult.artifacts).toEqual([
      {
        artifactId: 'artifact_1',
        name: 'patch.diff',
        kind: 'diff',
        mimeType: 'text/x-diff',
      },
    ]);
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
    expect('items' in result.result).toBe(false);
    const taskResult = result.result as Exclude<typeof result.result, { items: unknown }>;
    expect(taskResult.state).toBe('cancelled');
    expect(taskResult.status).toEqual({
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

  test('serves task history query requests', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async listTasks() {
          return [
            {
              id: 'task_1',
              state: 'completed',
              capability: 'patch',
              createdAt: '2026-02-28T00:00:00.000Z',
            },
            {
              id: 'task_2',
              state: 'failed',
              capability: 'debug',
              createdAt: '2026-02-28T01:00:00.000Z',
            },
          ];
        },
      },
    });

    const result = await handler.handle({
      method: 'tasks/list',
      params: {},
      id: '5',
    });

    expect(result.id).toBe('5');
    expect('items' in result.result).toBe(true);
    const listResult = result.result as Extract<typeof result.result, { items: unknown }>;
    expect(listResult.items).toHaveLength(2);
    expect(listResult.items[0]).toMatchObject({
      id: 'task_1',
      status: { state: 'completed' },
    });
    expect(listResult.items[1]).toMatchObject({
      id: 'task_2',
      status: { state: 'failed' },
    });
  });
});
