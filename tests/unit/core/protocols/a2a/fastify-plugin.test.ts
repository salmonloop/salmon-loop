import { Readable } from 'node:stream';

import { describe, expect, test } from 'bun:test';

import { createA2AFastifyPlugin } from '../../../../../src/core/protocols/a2a/server/fastify-plugin.js';

type RouteRegistration = {
  method: string;
  url: string;
  handler: (request: unknown, reply: unknown) => Promise<void>;
};

function createFastifyMock() {
  const routes: RouteRegistration[] = [];
  return {
    routes,
    instance: {
      route: (options: RouteRegistration) => {
        routes.push(options);
      },
    },
  };
}

function createReplyMock() {
  const headers = new Map<string, string>();
  return {
    headers,
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    header(key: string, value: string) {
      headers.set(key.toLowerCase(), value);
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe('A2A fastify plugin', () => {
  test('registers the A2A routes on fastify', async () => {
    const fastify = createFastifyMock();
    const plugin = createA2AFastifyPlugin({
      routes: { handle: async () => new Response('ok') },
    });

    await plugin(fastify.instance as any);

    const registered = fastify.routes.map((route) => `${route.method} ${route.url}`);
    expect(registered).toEqual([
      'GET /.well-known/agent-card.json',
      'POST /rpc',
      'GET /tasks/:taskId/subscribe',
      'GET /artifacts/:artifactId',
    ]);
  });

  test('maps a2a responses into fastify replies', async () => {
    const fastify = createFastifyMock();
    const plugin = createA2AFastifyPlugin({
      routes: {
        handle: async () =>
          new Response('hello', {
            status: 202,
            headers: { 'content-type': 'text/plain' },
          }),
      },
      baseUrl: 'https://example.com',
    });

    await plugin(fastify.instance as any);
    const rpcRoute = fastify.routes.find((route) => route.url === '/rpc');
    expect(rpcRoute).toBeDefined();

    const reply = createReplyMock();
    await rpcRoute!.handler(
      { method: 'POST', url: '/rpc', headers: { 'content-type': 'application/json' } },
      reply,
    );

    expect(reply.statusCode).toBe(202);
    expect(reply.headers.get('content-type')).toBe('text/plain');
  });

  test('streams SSE responses through fastify', async () => {
    const fastify = createFastifyMock();
    const plugin = createA2AFastifyPlugin({
      routes: {
        handle: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('event: ping\n\n'));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            },
          ),
      },
      baseUrl: 'https://example.com',
    });

    await plugin(fastify.instance as any);
    const subscribeRoute = fastify.routes.find((route) => route.url === '/tasks/:taskId/subscribe');
    expect(subscribeRoute).toBeDefined();

    const reply = createReplyMock();
    await subscribeRoute!.handler(
      { method: 'GET', url: '/tasks/task_1/subscribe', headers: {} },
      reply,
    );

    expect(reply.payload).toBeInstanceOf(Readable);
  });
});
