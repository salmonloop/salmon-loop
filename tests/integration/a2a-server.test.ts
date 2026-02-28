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
    await expect(rpcResponse.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '1',
      result: {
        id: 'task_1',
        state: 'accepted',
        status: {
          state: 'submitted',
        },
      },
    });

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

  test('serves task history queries over rpc', async () => {
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
          ];
        },
      },
    });

    const routes = createA2ARoutes({
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: 'https://example.com',
          capabilities: [{ id: 'patch', title: 'Patch code' }],
          security: [],
        }),
      jsonRpcHandler: handler,
      eventSource: createSseEventSource(),
    });

    const server = createA2AHttpServer({ routes });
    const response = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '9',
          method: 'tasks/list',
          params: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '9',
      result: {
        items: [
          {
            id: 'task_1',
            status: { state: 'completed' },
          },
        ],
      },
    });
  });

  test('serves task input submission and artifact fetch over rpc', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async submitInput() {
          return {
            id: 'task_1',
            state: 'running',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
            statusMessage: 'Resumed after confirmation',
          };
        },
        async getArtifact() {
          return {
            id: 'task_1',
            state: 'completed',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
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

    const routes = createA2ARoutes({
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: 'https://example.com',
          capabilities: [{ id: 'patch', title: 'Patch code' }],
          security: [],
        }),
      jsonRpcHandler: handler,
      eventSource: createSseEventSource(),
    });

    const server = createA2AHttpServer({ routes });

    const submitResponse = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '10',
          method: 'tasks/submitInput',
          params: {
            id: 'task_1',
            input: { type: 'confirmation', value: 'approve' },
          },
        }),
      }),
    );

    expect(submitResponse.status).toBe(200);
    await expect(submitResponse.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '10',
      result: {
        id: 'task_1',
        status: {
          state: 'working',
          message: 'Resumed after confirmation',
        },
      },
    });

    const artifactResponse = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '11',
          method: 'tasks/getArtifact',
          params: {
            id: 'task_1',
            artifactId: 'artifact_1',
          },
        }),
      }),
    );

    expect(artifactResponse.status).toBe(200);
    await expect(artifactResponse.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '11',
      result: {
        id: 'task_1',
        artifacts: [
          {
            artifactId: 'artifact_1',
            name: 'patch.diff',
          },
        ],
      },
    });
  });
  test('serves task retry and reopen semantics over rpc', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async retryTask() {
          return {
            id: 'task_1',
            state: 'accepted',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
            attempt: 2,
            statusMessage: 'Task retried',
          };
        },
        async reopenTask() {
          return {
            id: 'task_2',
            state: 'awaiting_input',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
            statusMessage: 'Task reopened',
            inputRequired: {
              type: 'confirmation',
              reason: 'reopen',
              prompt: 'Provide updated approval',
            },
          };
        },
      },
    });

    const routes = createA2ARoutes({
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: 'https://example.com',
          capabilities: [{ id: 'patch', title: 'Patch code' }],
          security: [],
        }),
      jsonRpcHandler: handler,
      eventSource: createSseEventSource(),
    });

    const server = createA2AHttpServer({ routes });
    const retryResponse = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '20',
          method: 'tasks/retry',
          params: { id: 'task_1' },
        }),
      }),
    );

    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '20',
      result: {
        id: 'task_1',
        status: {
          state: 'submitted',
          message: 'Task retried',
        },
        metadata: {
          attempt: 2,
        },
      },
    });

    const reopenResponse = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '21',
          method: 'tasks/reopen',
          params: { id: 'task_2' },
        }),
      }),
    );

    expect(reopenResponse.status).toBe(200);
    await expect(reopenResponse.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '21',
      result: {
        id: 'task_2',
        status: {
          state: 'input-required',
          message: 'Task reopened',
        },
        requiredAction: {
          type: 'confirmation',
          reason: 'reopen',
          prompt: 'Provide updated approval',
        },
      },
    });
  });

  test('projects failure details on task lookup over rpc', async () => {
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async getTask() {
          return {
            id: 'task_3',
            state: 'failed',
            capability: 'verify',
            createdAt: '2026-02-28T00:00:00.000Z',
            attempt: 3,
            statusMessage: 'Verification failed',
            failure: {
              code: 'VERIFY_FAILED',
              category: 'verification',
              message: 'Tests did not pass',
              retryable: true,
            },
          };
        },
      },
    });

    const routes = createA2ARoutes({
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: 'https://example.com',
          capabilities: [{ id: 'verify', title: 'Verify code' }],
          security: [],
        }),
      jsonRpcHandler: handler,
      eventSource: createSseEventSource(),
    });

    const server = createA2AHttpServer({ routes });
    const response = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '22',
          method: 'tasks/get',
          params: { id: 'task_3' },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '22',
      result: {
        id: 'task_3',
        status: {
          state: 'failed',
          message: 'Verification failed',
        },
        failure: {
          code: 'VERIFY_FAILED',
          category: 'verification',
          message: 'Tests did not pass',
          retryable: true,
        },
        metadata: {
          attempt: 3,
          capability: 'verify',
        },
      },
    });
  });
  test('applies rpc method policy hooks and returns selected artifact content only', async () => {
    const seen: Array<{ action: string; resource: string; taskId: string | null }> = [];
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async getArtifact() {
          return {
            id: 'task_1',
            state: 'completed',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
            artifacts: [
              {
                id: 'artifact_1',
                name: 'patch.diff',
                kind: 'diff',
                mimeType: 'text/x-diff',
                content: 'diff --git a/file.ts b/file.ts',
              },
              {
                id: 'artifact_2',
                name: 'notes.txt',
                kind: 'text',
                mimeType: 'text/plain',
              },
            ],
          };
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

    const server = createA2AHttpServer({ routes });
    const artifactResponse = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '12',
          method: 'tasks/getArtifact',
          params: {
            id: 'task_1',
            artifactId: 'artifact_1',
          },
        }),
      }),
    );

    expect(artifactResponse.status).toBe(200);
    await expect(artifactResponse.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '12',
      result: {
        id: 'task_1',
        artifacts: [
          {
            artifactId: 'artifact_1',
            content: 'diff --git a/file.ts b/file.ts',
          },
        ],
      },
    });
    expect(seen).toEqual([
      {
        action: 'task.get_artifact',
        resource: 'task',
        taskId: 'task_1',
      },
    ]);
  });

  test('serves task resume and handle-delivered artifacts over authenticated routes', async () => {
    const seen: Array<{ action: string; resource: string; taskId: string | null }> = [];
    const handler = createA2AJsonRpcHandler({
      facade: {
        async createTask() {
          return { id: 'task_1', state: 'accepted' };
        },
        async resumeTask() {
          return {
            id: 'task_1',
            state: 'running',
            capability: 'patch',
            createdAt: '2026-02-28T00:00:00.000Z',
            statusMessage: 'Task resumed',
          };
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
      artifactStore: {
        async read(handle) {
          expect(handle).toBe('artifact-handle-1');
          return new Response('artifact body', {
            headers: { 'content-type': 'text/plain' },
          });
        },
      },
    });

    const server = createA2AHttpServer({ routes });

    const resumeResponse = await server.fetch(
      new Request('https://example.com/rpc', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '13',
          method: 'tasks/resume',
          params: { id: 'task_1' },
        }),
      }),
    );

    expect(resumeResponse.status).toBe(200);
    await expect(resumeResponse.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: '13',
      result: {
        id: 'task_1',
        status: {
          state: 'working',
          message: 'Task resumed',
        },
      },
    });

    const artifactRouteResponse = await server.fetch(
      new Request('https://example.com/artifacts/artifact-handle-1'),
    );

    expect(artifactRouteResponse.status).toBe(200);
    await expect(artifactRouteResponse.text()).resolves.toBe('artifact body');
    expect(seen).toEqual([
      {
        action: 'task.resume',
        resource: 'task',
        taskId: 'task_1',
      },
    ]);
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

  test('replays missed task events from last-event-id over SSE subscriptions', async () => {
    const bus = createTaskEventBus();
    bus.publish({ type: 'task.accepted', taskId: 'task_1' });
    bus.publish({ type: 'task.completed', taskId: 'task_1' });

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
    const response = await server.fetch(
      new Request('https://example.com/tasks/task_1/subscribe', {
        headers: { 'last-event-id': '1' },
      }),
    );

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const chunk = await reader!.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).toContain('id: 2');
    expect(text).toContain('event: task.completed');
  });
});
