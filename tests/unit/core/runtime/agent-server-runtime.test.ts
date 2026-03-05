import { describe, expect, test } from 'bun:test';

import { createAgentServerRuntime } from '../../../../src/core/runtime/agent-server-runtime.js';
import { buildSidecarRouteDescriptors } from '../../../../src/core/runtime/sidecar-route-catalog.js';

type RouteRegistration = { method: string; url: string };

function createFastifyFactory() {
  const servers: Array<{ routes: RouteRegistration[] }> = [];
  const listens: Array<{ port?: number; host?: string; path?: string }> = [];

  const factory = () => {
    const routes: RouteRegistration[] = [];
    const instance = {
      routes,
      route: (options: RouteRegistration) => {
        routes.push({ method: options.method, url: options.url });
      },
      register: async (plugin: any) => {
        await plugin(instance);
      },
      listen: async (options: { port?: number; host?: string; path?: string }) => {
        listens.push(options);
      },
      close: async () => undefined,
    };
    servers.push({ routes });
    return instance;
  };

  return { factory, servers, listens };
}

describe('agent server runtime', () => {
  test('registers A2A and sidecar routes and listens on both endpoints', async () => {
    const fastify = createFastifyFactory();

    const sidecarRoutes = buildSidecarRouteDescriptors({
      strict: true,
      catalog: [
        {
          id: 'health',
          method: 'GET',
          path: '/health',
          exposure: 'essential',
          scope: 'uds',
          policyTag: 'sidecar.health.read',
        },
      ],
      handlers: {
        health: async () => new Response('ok'),
      },
    });

    const runtime = createAgentServerRuntime({
      createFastify: fastify.factory,
      a2a: {
        buildAgentCard: () => ({ name: 'salmon-loop' }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port: 7447 },
        sidecar: { path: '/tmp/agent-message.sock' },
      },
    });

    await runtime.start();

    const a2aRoutes = fastify.servers[0].routes.map((route) => route.url);
    expect(a2aRoutes).toEqual([
      '/.well-known/agent-card.json',
      '/a2a/jsonrpc',
      '/tasks/:taskId/subscribe',
      '/artifacts/:artifactId',
    ]);
    expect(fastify.servers[1].routes).toEqual([{ method: 'GET', url: '/health' }]);
    expect(fastify.listens).toEqual([
      { host: '127.0.0.1', port: 7447 },
      { path: '/tmp/agent-message.sock' },
    ]);
  });
});
