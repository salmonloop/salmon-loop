import { describe, expect, test } from 'bun:test';

import { createTaskEventBus } from '../../src/core/interaction/events/bus.js';
import { buildA2AAgentCard } from '../../src/core/protocols/a2a/agent-card.js';
import {
  createA2AAuthPolicyMiddleware,
  createAllowAllA2APolicy,
  createBearerTokenAuthenticator,
} from '../../src/core/protocols/a2a/server/auth-policy.js';
import { createA2AHttpServer } from '../../src/core/protocols/a2a/server/http-server.js';
import { createA2AJsonRpcHandler } from '../../src/core/protocols/a2a/server/jsonrpc-handler.js';
import { createA2ARoutes } from '../../src/core/protocols/a2a/server/routes.js';
import { createSseEventSource } from '../../src/core/protocols/a2a/server/sse-stream.js';

describe('A2A server integration', () => {
  test('serves discovery, rpc, and sse subscription endpoints', async () => {
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
          url: 'https://example.com',
          capabilities: [{ id: 'patch', title: 'Patch code' }],
          security: [{ type: 'http', scheme: 'bearer' }],
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
      new Request('https://example.com/rpc', {
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

    const sseResponse = await server.fetch(
      new Request('https://example.com/tasks/task_1/subscribe'),
    );
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');
  });

  test('enforces bearer auth for rpc requests when auth policy is configured', async () => {
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
          url: 'https://example.com',
          capabilities: [{ id: 'patch', title: 'Patch code' }],
          security: [{ type: 'http', scheme: 'bearer' }],
        }),
      jsonRpcHandler: handler,
      eventSource: createSseEventSource(),
      authPolicy: createA2AAuthPolicyMiddleware({
        authenticator: createBearerTokenAuthenticator({ tokens: ['secret-token'] }),
        policy: createAllowAllA2APolicy(),
      }),
    });

    const server = createA2AHttpServer({ routes });

    const unauthorizedResponse = await server.fetch(
      new Request('https://example.com/rpc', {
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
    expect(unauthorizedResponse.status).toBe(401);

    const authorizedResponse = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '2',
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
    expect(authorizedResponse.status).toBe(200);
  });

  test('streams live task events over SSE subscriptions', async () => {
    const bus = createTaskEventBus();
    const routes = createA2ARoutes({
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: 'https://example.com',
          capabilities: [{ id: 'patch', title: 'Patch code' }],
          security: [],
        }),
      jsonRpcHandler: {
        handle: async () => ({ jsonrpc: '2.0', id: '1', result: { id: 'task_1' } }),
      },
      eventSource: createSseEventSource(bus),
    });

    const server = createA2AHttpServer({ routes });
    const response = await server.fetch(new Request('https://example.com/tasks/task_1/subscribe'));

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    bus.publish({ type: 'task.completed', taskId: 'task_1' });

    const chunk = await reader!.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).toContain('event: task.completed');
    expect(text).toContain('"taskId":"task_1"');
  });
});
