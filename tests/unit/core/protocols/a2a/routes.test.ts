import { describe, expect, test } from 'bun:test';

import {
  createA2AAuthPolicyMiddleware,
  createAllowAllA2APolicy,
  createBearerTokenAuthenticator,
} from '../../../../../src/core/protocols/a2a/server/auth-policy.js';
import { A2AJsonRpcError } from '../../../../../src/core/protocols/a2a/server/jsonrpc-error.js';
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
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
      },
    });
  });

  test('returns JSON-RPC error envelopes for handler failures', async () => {
    const routes = createA2ARoutes({
      buildAgentCard: () => ({
        name: 'salmon-loop',
        url: 'https://example.com',
        skills: [],
        securitySchemes: [],
      }),
      jsonRpcHandler: {
        handle: async () => {
          throw new A2AJsonRpcError({
            code: -32601,
            message: 'Unsupported method: nope',
            status: 400,
          });
        },
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
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '99',
          method: 'nope',
          params: {},
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: '99',
      error: {
        code: -32601,
        message: 'Unsupported method: nope',
      },
    });
  });

  test('returns JSON-RPC auth errors for unauthenticated rpc requests', async () => {
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
      authPolicy: createA2AAuthPolicyMiddleware({
        authenticator: createBearerTokenAuthenticator({ tokens: ['secret-token'] }),
        policy: createAllowAllA2APolicy(),
      }),
    });

    const response = await routes.handle(
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

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: '1',
      error: {
        code: -32001,
        message: 'Missing bearer token',
      },
    });
  });

  test('returns http policy errors for forbidden subscription requests', async () => {
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
      authPolicy: createA2AAuthPolicyMiddleware({
        authenticator: createBearerTokenAuthenticator({ tokens: ['secret-token'] }),
        policy: {
          async authorize() {
            return { allowed: false, status: 403, message: 'Task stream forbidden' };
          },
        },
      }),
    });

    const response = await routes.handle(
      new Request('https://example.com/tasks/task_1/subscribe', {
        headers: { authorization: 'Bearer secret-token' },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe('Task stream forbidden');
  });

  test('passes action and task resource context into policy hooks', async () => {
    const seen: Array<{ action: string; resource: string; taskId: string | null }> = [];
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
      authPolicy: createA2AAuthPolicyMiddleware({
        authenticator: createBearerTokenAuthenticator({ tokens: ['secret-token'] }),
        policy: {
          async authorize(input) {
            seen.push({
              action: input.action,
              resource: input.resource,
              taskId: input.taskId ?? null,
            });
            return { allowed: true };
          },
        },
      }),
    });

    await routes.handle(
      new Request('https://example.com/tasks/task_42/subscribe', {
        headers: { authorization: 'Bearer secret-token' },
      }),
    );

    expect(seen).toEqual([
      {
        action: 'task.subscribe',
        resource: 'task',
        taskId: 'task_42',
      },
    ]);
  });

  test('derives rpc policy actions from the invoked method', async () => {
    const seen: Array<{ action: string; resource: string; taskId: string | null }> = [];
    const routes = createA2ARoutes({
      buildAgentCard: () => ({
        name: 'salmon-loop',
        url: 'https://example.com',
        skills: [],
        securitySchemes: [],
      }),
      jsonRpcHandler: {
        handle: async () => ({ jsonrpc: '2.0', id: '2', result: { id: 'task_1' } }),
      },
      eventSource: {
        open: () =>
          new Response('event: ping\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      },
      authPolicy: createA2AAuthPolicyMiddleware({
        authenticator: createBearerTokenAuthenticator({ tokens: ['secret-token'] }),
        policy: {
          async authorize(input) {
            seen.push({
              action: input.action,
              resource: input.resource,
              taskId: input.taskId ?? null,
            });
            return { allowed: true };
          },
        },
      }),
    });

    const response = await routes.handle(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '2',
          method: 'tasks/submitInput',
          params: {
            id: 'task_1',
            input: { type: 'confirmation', value: 'approve' },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([
      {
        action: 'task.submit_input',
        resource: 'task',
        taskId: 'task_1',
      },
    ]);
  });
});
