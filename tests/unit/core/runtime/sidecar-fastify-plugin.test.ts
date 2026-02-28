import { describe, expect, test } from 'bun:test';

import {
  createSidecarFastifyPlugin,
  type RouteDescriptor,
} from '../../../../src/core/runtime/sidecar-fastify-plugin.js';

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

describe('sidecar fastify plugin', () => {
  test('filters routes by exposure and scope', async () => {
    const fastify = createFastifyMock();
    const routes: RouteDescriptor[] = [
      {
        method: 'GET',
        path: '/health',
        exposure: 'essential',
        scope: 'both',
        policyTag: 'health.read',
        handler: async () => new Response('ok'),
      },
      {
        method: 'GET',
        path: '/logs/stream',
        exposure: 'conditional',
        scope: 'uds',
        policyTag: 'logs.read',
        handler: async () => new Response('stream'),
      },
      {
        method: 'POST',
        path: '/shutdown',
        exposure: 'forbidden',
        scope: 'both',
        policyTag: 'lifecycle.shutdown',
        handler: async () => new Response('no'),
      },
    ];

    const plugin = createSidecarFastifyPlugin({
      routes,
      scope: 'tcp',
      allowConditional: false,
    });

    await plugin(fastify.instance as any);

    const registered = fastify.routes.map((route) => `${route.method} ${route.url}`);
    expect(registered).toEqual(['GET /health']);
  });

  test('enforces route policy when provided', async () => {
    const fastify = createFastifyMock();
    const routes: RouteDescriptor[] = [
      {
        method: 'POST',
        path: '/abort',
        exposure: 'essential',
        scope: 'both',
        policyTag: 'task.abort',
        handler: async () => new Response('ok'),
      },
    ];

    const plugin = createSidecarFastifyPlugin({
      routes,
      scope: 'tcp',
      authorize: async () => ({ allowed: false, status: 403, message: 'forbidden' }),
    });

    await plugin(fastify.instance as any);
    const route = fastify.routes[0];
    const reply = createReplyMock();

    await route.handler({ method: 'POST', url: '/abort', headers: {} }, reply);

    expect(reply.statusCode).toBe(403);
  });
});
