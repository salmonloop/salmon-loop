import { describe, expect, test } from 'bun:test';

import { createA2ARoutes } from '../../../../../src/core/protocols/a2a/server/routes.js';

describe('A2A routes', () => {
  test('serves the agent card from the well-known route', async () => {
    const routes = createA2ARoutes({
      buildAgentCard: () => ({
        name: 'salmon-loop',
        url: 'https://example.com',
        skills: [{ id: 'patch', name: 'Patch code' }],
        securitySchemes: [{ type: 'http', scheme: 'bearer' }],
      }),
      jsonRpcHandler: {
        handle: async () => ({ jsonrpc: '2.0', id: '1', result: { id: 'task_1' } }),
      },
      eventSource: {
        open: () =>
          new Response('event: ping\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      },
    });

    const response = await routes.handle(
      new Request('https://example.com/.well-known/agent-card.json'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('serves SSE responses for task subscriptions', async () => {
    const routes = createA2ARoutes({
      buildAgentCard: () => ({
        name: 'salmon-loop',
        url: 'https://example.com',
        skills: [],
        securitySchemes: [],
      }),
      jsonRpcHandler: {
        handle: async () => ({ jsonrpc: '2.0', id: '1', result: { id: 'task_1' } }),
      },
      eventSource: {
        open: () =>
          new Response('event: task.updated\ndata: {"id":"task_1"}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      },
    });

    const response = await routes.handle(new Request('https://example.com/tasks/task_1/subscribe'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  });

  test('returns 400 for malformed rpc json bodies', async () => {
    const routes = createA2ARoutes({
      buildAgentCard: () => ({
        name: 'salmon-loop',
        url: 'https://example.com',
        skills: [],
        securitySchemes: [],
      }),
      jsonRpcHandler: {
        handle: async () => ({ jsonrpc: '2.0', id: '1', result: { id: 'task_1' } }),
      },
      eventSource: {
        open: () =>
          new Response('event: ping\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      },
    });

    const response = await routes.handle(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad-json',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });
});
