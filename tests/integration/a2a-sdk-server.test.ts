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

async function deferExecution(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function createAbortOnlyTask(task: TaskEnvelope, signal?: AbortSignal): Promise<TaskEnvelope> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ...task, state: 'cancelled', statusMessage: 'cancelled' });
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        resolve({ ...task, state: 'cancelled', statusMessage: 'cancelled' });
      },
      { once: true },
    );
  });
}

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
  const runNetworkIntegration = process.env.RUN_A2A_NETWORK_INTEGRATION === '1';
  const networkIntegrationTest = runNetworkIntegration ? test : test.skip;

  networkIntegrationTest('message/send returns a completed task that can be queried', async () => {
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

  networkIntegrationTest(
    'message/stream yields status updates and cancel observes cancellation',
    async () => {
      const { url, close } = await startTestServer({
        executeTask: (task, options) => createAbortOnlyTask(task, options?.signal),
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
    },
  );

  /**
   * Bug Condition Exploration Test - Property 1: Fault Condition
   * **Validates: Requirements - Race Condition Between Completion and Cancellation**
   *
   * This test verifies that when a task completes and cancellation is requested during
   * the grace period, only "canceled" status is published (no "completed" event).
   *
   * Original Issue: When cancellation arrives after task completion, the SSE stream
   * would publish "completed", call eventBus.finished(), and close the stream before
   * the cancellation could be processed. This caused iterator.next() to receive
   * "completed" instead of "canceled".
   *
   * Fix: Delay publishing "completed" by COMPLETION_GRACE_PERIOD_MS to allow
   * cancellation requests to arrive. Check store state after delay to detect
   * cancellation and publish "canceled" instead.
   */
  networkIntegrationTest(
    'BUG CONDITION: cancellation during grace period publishes only canceled status',
    async () => {
      const { url, close } = await startTestServer({
        executeTask: async (task) => {
          // Task completes immediately
          return { ...task, state: 'completed' };
        },
      });
      try {
        const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
        const iterator = transport.sendMessageStream({ message: createMessage('msg-race') });

        const first = await iterator.next();
        expect(first.done).toBe(false);
        const firstUpdate = first.value as TaskStatusUpdateEvent;
        expect(firstUpdate.status.state).toBe('submitted');

        const taskId = firstUpdate.taskId;
        expect(taskId).toBeDefined();

        // Cancel immediately after task completes (during grace period)
        await transport.cancelTask({ id: taskId! });

        // Collect all subsequent status updates
        const statusUpdates: TaskStatusUpdateEvent[] = [];
        let result = await iterator.next();
        while (!result.done) {
          if (result.value && result.value.kind === 'status-update') {
            statusUpdates.push(result.value as TaskStatusUpdateEvent);
          }
          result = await iterator.next();
        }

        // Verify only "canceled" status is published (no "completed")
        const completedUpdates = statusUpdates.filter((u) => u.status.state === 'completed');
        const canceledUpdates = statusUpdates.filter((u) => u.status.state === 'canceled');

        expect(completedUpdates.length).toBe(0); // No completed status should be published
        expect(canceledUpdates.length).toBe(1); // Only one canceled status
        expect(canceledUpdates[0].final).toBe(true);

        await iterator.return();
      } finally {
        await close();
      }
    },
  );

  /**
   * Preservation Property Tests - Property 2: Preservation
   */

  networkIntegrationTest('PRESERVATION: task completes normally without cancellation', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'completed' };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-normal') });

      const first = await iterator.next();
      expect(first.done).toBe(false);
      const firstUpdate = first.value as TaskStatusUpdateEvent;
      expect(firstUpdate.status.state).toBe('submitted');

      const second = await iterator.next();
      expect(second.done).toBe(false);
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('completed');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  networkIntegrationTest('PRESERVATION: task cancelled before completion', async () => {
    const { url, close } = await startTestServer({
      executeTask: (task, options) => createAbortOnlyTask(task, options?.signal),
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-cancel') });

      const first = await iterator.next();
      const firstUpdate = first.value as TaskStatusUpdateEvent;
      const taskId = firstUpdate.taskId;
      await transport.cancelTask({ id: taskId! });

      const second = await iterator.next();
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('canceled');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  networkIntegrationTest('PRESERVATION: failed tasks publish failed status', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'failed', statusMessage: 'error' };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-fail') });

      const first = await iterator.next();
      const firstUpdate = first.value as TaskStatusUpdateEvent;
      expect(firstUpdate.status.state).toBe('submitted');

      const second = await iterator.next();
      const secondUpdate = second.value as TaskStatusUpdateEvent;
      expect(secondUpdate.status.state).toBe('failed');
      expect(secondUpdate.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });

  networkIntegrationTest('PRESERVATION: terminal states have final flag', async () => {
    const { url, close } = await startTestServer({
      executeTask: async (task) => {
        await deferExecution();
        return { ...task, state: 'completed' };
      },
    });
    try {
      const transport = new JsonRpcTransport({ endpoint: `${url}/a2a/jsonrpc` });
      const iterator = transport.sendMessageStream({ message: createMessage('msg-term') });

      let completedUpdate: TaskStatusUpdateEvent | null = null;
      let result = await iterator.next();
      while (!result.done) {
        if (result.value && result.value.kind === 'status-update') {
          const update = result.value as TaskStatusUpdateEvent;
          if (update.status.state === 'completed') {
            completedUpdate = update;
            break;
          }
        }
        result = await iterator.next();
      }

      expect(completedUpdate).not.toBeNull();
      expect(completedUpdate?.final).toBe(true);

      await iterator.return();
    } finally {
      await close();
    }
  });
});
