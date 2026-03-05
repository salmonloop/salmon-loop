import http from 'http';
import type { AddressInfo } from 'net';

import type { Message, TaskStatusUpdateEvent } from '@a2a-js/sdk';
import { JsonRpcTransport } from '@a2a-js/sdk/client';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../src/core/interaction/events/bus.js';
import type { TaskEnvelope } from '../../src/core/interaction/model/index.js';
import { createInteractionFacade } from '../../src/core/interaction/orchestration/facade.js';
import { buildA2AAgentCard } from '../../src/core/protocols/a2a/agent-card.js';
import { createA2AInteractionExecutor } from '../../src/core/protocols/a2a/sdk/executor.js';
import { createA2ASdkExpressApp } from '../../src/core/protocols/a2a/sdk/server.js';

const BASE_CAPABILITIES = [{ id: 'patch', title: 'Patch code' }];

type ServerHandle = {
  url: string;
  close: () => Promise<void>;
};

type ExecuteTaskFn = (
  task: TaskEnvelope,
  options?: { signal?: AbortSignal },
) => Promise<TaskEnvelope>;

async function startTestServer(deps: { executeTask: ExecuteTaskFn }) {
  const taskBus = createTaskEventBus();
  const taskStore = new InMemoryTaskStore();
  const facade = createInteractionFacade({ executeTask: deps.executeTask, eventBus: taskBus });
  const executor = createA2AInteractionExecutor({ facade, taskEventBus: taskBus, taskStore });
  const app = createA2ASdkExpressApp({
    agentCard: buildA2AAgentCard({
      name: 'test-agent',
      url: 'http://localhost',
      capabilities: BASE_CAPABILITIES,
      security: [],
    }),
    agentExecutor: executor,
    taskStore,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err?: Error) => {
      if (err) return reject(err);
      resolve();
    });
    server.on('error', reject);
  });
  const address = server.address() as AddressInfo;
  const url = `http://${address.address}:${address.port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => (err ? reject(err) : resolve()));
      }),
  } satisfies ServerHandle;
}

function createMessage(id: string): Message {
  return {
    kind: 'message',
    messageId: id,
    role: 'user',
    parts: [{ kind: 'text', text: 'fix bug' }],
    contextId: id,
  };
}

describe('A2A SDK express server', () => {
  test('message/send returns a completed task that can be queried', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const result = await transport.sendMessage({
        message: createMessage('msg-1'),
      });

      expect(result.kind).toBe('task');
      if (result.kind !== 'task') {
        throw new Error('expected task response');
      }
      expect(result.status.state).toBe('completed');

      const stored = await transport.getTask({ id: result.id });
      if (!stored) {
        throw new Error('missing stored task');
      }
      expect(stored.status.state).toBe('completed');
      expect(stored.metadata?.capability).toBe('patch');
    } finally {
      await close();
    }
  });

  test('message/stream yields status updates and cancel observes cancellation', async () => {
    const { url, close } = await startTestServer({
      executeTask: (task, options) =>
        new Promise((resolve) => {
          if (options?.signal?.aborted) {
            resolve({ ...task, state: 'cancelled', statusMessage: 'cancelled' });
            return;
          }
          const timer = setTimeout(() => resolve({ ...task, state: 'completed' }), 400);
          options?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve({
              ...task,
              state: 'cancelled',
              statusMessage: 'cancelled',
            });
          });
        }),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-2') });

      const first = await iterator.next();
      expect(first.done).toBe(false);
      if (!first.value || first.value.kind !== 'status-update') {
        throw new Error('expected first event to be a status update');
      }
      const firstUpdate = first.value as TaskStatusUpdateEvent;
      expect(firstUpdate.status.state).toBe('submitted');

      const taskId = firstUpdate.taskId;
      expect(taskId).toBeDefined();
      await transport.cancelTask({ id: taskId! });
      const second = await iterator.next();
      expect(second.done).toBe(false);
      if (!second.value || second.value.kind !== 'status-update') {
        throw new Error('expected second event to be a status update');
      }
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('canceled');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });
});
