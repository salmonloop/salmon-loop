import { describe, expect, it } from 'bun:test';

import { createAcpJsonRpcHandler } from '../../../src/core/protocols/acp/jsonrpc.js';

function createHandler() {
  return createAcpJsonRpcHandler({
    agentInfo: { name: 'salmon-loop', version: '0.2.0' },
    emitNotification: async () => {},
    facade: {
      createTask: async () => ({
        task: {
          id: 'task_1',
          state: 'accepted',
          capability: 'patch',
          request: { instruction: 'hi' },
          createdAt: new Date().toISOString(),
        },
        signal: new AbortController().signal,
      }),
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

describe('ACP initialize', () => {
  it('returns initialize result with capabilities', async () => {
    const handler = createHandler();
    const response = await handler.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'test', version: '0.0.0' },
        capabilities: {},
      },
    });

    expect(response).toBeTruthy();
    if (!response || 'error' in response) {
      throw new Error('Expected initialize response');
    }
    const result = response.result as any;
    expect(result).toBeTruthy();
    expect(result.protocolVersion).toBe(1);
    expect(result.agentCapabilities).toBeTruthy();
    expect(result.agentInfo?.name).toBe('salmon-loop');
  });
});
