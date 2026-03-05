import { describe, expect, test } from 'bun:test';

import { buildA2AAgentCard } from '../../src/core/protocols/a2a/agent-card.js';
import { createA2AHttpServer } from '../../src/core/protocols/a2a/server/http-server.js';
import { createA2AJsonRpcHandler } from '../../src/core/protocols/a2a/server/jsonrpc-handler.js';
import { createA2ARoutes } from '../../src/core/protocols/a2a/server/routes.js';
import { createSseEventSource } from '../../src/core/protocols/a2a/server/sse-stream.js';

describe('A2A SDK-compatible server surface', () => {
  test('serves agent card and JSON-RPC entrypoint at /a2a/jsonrpc', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
      },
    });

    const routes = createA2ARoutes({
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: 'https://example.com/a2a/jsonrpc',
          capabilities: [{ id: 'patch', title: 'Patch code' }],
          security: [],
        }),
      jsonRpcHandler: handler,
      eventSource: createSseEventSource(),
    });

    const server = createA2AHttpServer({ routes });

    const cardResponse = await server.fetch(
      new Request('https://example.com/.well-known/agent-card.json'),
    );
    expect(cardResponse.status).toBe(200);

    const rpcResponse = await server.fetch(
      new Request('https://example.com/a2a/jsonrpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'message/send',
          params: {
            message: {
              role: 'user',
              parts: [{ type: 'text', text: 'fix bug' }],
            },
          },
        }),
      }),
    );

    expect(rpcResponse.status).toBe(200);
  });
});
