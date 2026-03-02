import { describe, expect, it } from 'bun:test';

import { createAcpJsonRpcHandler } from '../../../src/core/protocols/acp/jsonrpc.js';

function createHandler() {
  return createAcpJsonRpcHandler({
    agentInfo: { name: 'salmon-loop', version: '0.2.0' },
    emitNotification: async () => {},
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
}

describe('ACP session draft methods', () => {
  it('lists and deletes sessions', async () => {
    const handler = createHandler();

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

    const listResponse = await handler.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/list',
      params: {},
    });
    if (!listResponse || 'error' in listResponse) {
      throw new Error('Expected session/list response');
    }

    const sessions = listResponse.result?.sessions as Array<{ sessionId: string }>;
    expect(sessions.some((entry) => entry.sessionId === sessionId)).toBe(true);

    const deleteResponse = await handler.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/delete',
      params: { sessionId },
    });

    expect(deleteResponse?.result).toBeTruthy();
  });
});
