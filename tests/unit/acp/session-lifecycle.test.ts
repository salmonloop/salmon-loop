import { describe, expect, it } from 'bun:test';

import { createAcpJsonRpcHandler } from '../../../src/core/protocols/acp/jsonrpc.js';

function createEventBus() {
  const listeners = new Set<(event: any) => void>();
  return {
    subscribe(listener: (event: any) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event: any) {
      for (const listener of listeners) listener(event);
    },
    list() {
      return [];
    },
  };
}

describe('ACP session lifecycle', () => {
  it('creates a session and completes a prompt', async () => {
    const notifications: any[] = [];
    const eventBus = createEventBus();
    let taskCounter = 0;

    const handler = createAcpJsonRpcHandler({
      agentInfo: { name: 'salmon-loop', version: '0.2.0' },
      emitNotification: async (note) => {
        notifications.push(note);
      },
      eventBus,
      facade: {
        createTask: async () => {
          taskCounter += 1;
          return {
            task: {
              id: `task_${taskCounter}`,
              state: 'accepted',
              capability: 'patch',
              request: { instruction: 'hi' },
              createdAt: new Date().toISOString(),
            },
            signal: new AbortController().signal,
          } as any;
        },
        getTask: async () => null,
        cancelTask: async () => null,
        resumeTask: async () => null,
        retryTask: async () => null,
        reopenTask: async () => null,
        listTasks: async () => ({ items: [] }),
        submitInput: async () => null,
        getArtifact: async () => null,
      },
    });

    const createResponse = await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] },
    });

    if (!createResponse || 'error' in createResponse) {
      throw new Error('Expected session/new response');
    }

    const sessionId = createResponse.result?.sessionId as string;
    expect(sessionId).toBeTruthy();

    const promptPromise = handler.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'Hello' }] },
    });

    setTimeout(() => {
      eventBus.publish({ type: 'task.completed', taskId: 'task_1' });
    }, 0);

    const promptResponse = await promptPromise;
    if (!promptResponse || 'error' in promptResponse) {
      throw new Error('Expected session/prompt response');
    }

    expect(promptResponse.result?.stopReason).toBe('end_turn');
    expect(notifications.length).toBeGreaterThan(0);
    const updateMethods = notifications.map((note) => note.method);
    expect(updateMethods).toContain('session/update');
  });

  it('handles session cancel as a notification', async () => {
    const notifications: any[] = [];
    const eventBus = createEventBus();

    const handler = createAcpJsonRpcHandler({
      agentInfo: { name: 'salmon-loop', version: '0.2.0' },
      emitNotification: async (note) => {
        notifications.push(note);
      },
      eventBus,
      facade: {
        createTask: async () =>
          ({
            task: {
              id: 'task_1',
              state: 'accepted',
              capability: 'patch',
              request: { instruction: 'hi' },
              createdAt: new Date().toISOString(),
            },
            signal: new AbortController().signal,
          }) as any,
        getTask: async () => null,
        cancelTask: async () => null,
        resumeTask: async () => null,
        retryTask: async () => null,
        reopenTask: async () => null,
        listTasks: async () => ({ items: [] }),
        submitInput: async () => null,
        getArtifact: async () => null,
      },
    });

    const createResponse = await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] },
    });
    if (!createResponse || 'error' in createResponse) {
      throw new Error('Expected session/new response');
    }

    const sessionId = createResponse.result?.sessionId as string;

    const cancelResponse = await handler.handle({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId },
    });

    expect(cancelResponse).toBeNull();
    expect(notifications.length).toBeGreaterThan(0);
  });
});
