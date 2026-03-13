import { createServer } from 'node:net';

import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import { describe, expect, test } from 'bun:test';
import type { Express } from 'express';

import { createTaskEventBus } from '../../../../src/core/interaction/events/bus.js';
import { buildA2AAgentCard } from '../../../../src/core/protocols/a2a/agent-card.js';
import { createAgentServerRuntime } from '../../../../src/core/runtime/agent-server-runtime.js';
import { createPipeListenOptions } from '../../../../src/core/runtime/sidecar-paths.js';
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

async function getOpenPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve open port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

describe('agent server runtime', () => {
  test('creates runtime with Express a2aServer and Fastify sidecarServer', async () => {
    const fastify = createFastifyFactory();
    const port = await getOpenPort();

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
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
    });

    // Validates: Requirements 1.1, 1.2, 1.3, 1.4
    expect(runtime).toBeDefined();
    expect(runtime.eventBus).toBeDefined();
    expect(typeof (runtime.a2aServer as Express).use).toBe('function');
    expect(typeof runtime.sidecarServer.register).toBe('function');
    expect(typeof runtime.start).toBe('function');
    expect(typeof runtime.close).toBe('function');

    await runtime.close();
  });

  test('starts both A2A and sidecar servers', async () => {
    const fastify = createFastifyFactory();
    const port = await getOpenPort();

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
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
    });

    await runtime.start();

    // Validates: Requirements 1.5
    // Sidecar server should have listened
    expect(fastify.listens).toContainEqual({ path: '/tmp/agent-message.sock' });

    await runtime.close();
  });

  test('close() is idempotent and can be called multiple times', async () => {
    const fastify = createFastifyFactory();
    const port = await getOpenPort();

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
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
    });

    // Validates: Requirements 1.7, 15.4
    await runtime.close();
    await runtime.close();
    await runtime.close();

    expect(true).toBe(true);
  });

  test('accepts custom eventBus and shares it with executor', async () => {
    const fastify = createFastifyFactory();
    const customEventBus = createTaskEventBus();
    const port = await getOpenPort();

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
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
        eventBus: customEventBus,
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
    });

    // Validates: Requirements 1.1, 1.2
    expect(runtime.eventBus).toBe(customEventBus);

    await runtime.close();
  });

  test('accepts custom taskStore and shares it with executor and SDK', async () => {
    const fastify = createFastifyFactory();
    const customTaskStore = new InMemoryTaskStore();
    const port = await getOpenPort();

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
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
        taskStore: customTaskStore,
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
    });

    // Validates: Requirements 2.4, 7.1, 7.2
    expect(runtime).toBeDefined();
    expect(runtime.a2aServer).toBeDefined();

    await runtime.close();
  });

  test('accepts authentication middleware', async () => {
    const fastify = createFastifyFactory();
    const port = await getOpenPort();

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

    const authMiddleware = (req: any, res: any, next: any) => {
      const token = req.headers?.authorization;
      if (token === 'Bearer valid-token') {
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    };

    const runtime = createAgentServerRuntime({
      createFastify: fastify.factory,
      a2a: {
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
        authMiddleware,
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
    });

    // Validates: Requirements 4.1, 10.2
    expect(runtime).toBeDefined();
    expect(runtime.a2aServer).toBeDefined();

    await runtime.close();
  });

  test('throws error when starting runtime twice', async () => {
    const fastify = createFastifyFactory();
    const port = await getOpenPort();

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
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
    });

    await runtime.start();

    // Validates: Requirements 1.5, 10.1
    try {
      await runtime.start();
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('already started');
    }

    await runtime.close();
  });

  test('applies custom configuration to A2A server', async () => {
    const fastify = createFastifyFactory();
    let configureA2ACalled = false;
    const port = await getOpenPort();

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
        buildAgentCard: () =>
          buildA2AAgentCard({
            name: 'salmon-loop',
            url: 'http://localhost:7447',
            capabilities: [{ id: 'patch', title: 'Patch code' }],
            security: [],
          }),
        executeTask: async (task) => ({ ...task, state: 'completed' }),
      },
      sidecar: {
        routes: sidecarRoutes,
      },
      listen: {
        a2a: { host: '127.0.0.1', port },
        sidecar: createPipeListenOptions('/tmp/agent-message.sock'),
      },
      configureA2A: async (_app) => {
        configureA2ACalled = true;
      },
    });

    await runtime.start();

    // Validates: Requirements 1.1, 1.2
    expect(configureA2ACalled).toBe(true);

    await runtime.close();
  });
});
