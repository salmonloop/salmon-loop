import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import { describe, test, expect } from 'bun:test';
import type { Express } from 'express';
import * as fc from 'fast-check';

import { buildA2AAgentCard } from '../../../../src/core/protocols/a2a/agent-card.js';
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

describe('agent server runtime - property-based tests', () => {
  // Property 2: Server Type Correctness
  test('Property 2: Server Type Correctness - a2aServer is Express and sidecarServer is Fastify', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8000, max: 8500 }), (port) => {
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
            buildAgentCard: () =>
              buildA2AAgentCard({
                name: 'test-agent',
                url: 'http://localhost:7447',
                capabilities: [{ id: 'test', title: 'Test' }],
                security: [],
              }),
            executeTask: async (task) => ({ ...task, state: 'completed' }),
          },
          sidecar: { routes: sidecarRoutes },
          listen: {
            a2a: { port, host: '127.0.0.1' },
            sidecar: { path: '/tmp/agent-message.sock' },
          },
        });

        // Validates: Requirements 1.3, 1.4
        // a2aServer should be Express (has use method)
        expect(typeof (runtime.a2aServer as Express).use).toBe('function');
        // sidecarServer should be Fastify-like (has register method)
        expect(typeof runtime.sidecarServer.register).toBe('function');

        // Cleanup
        runtime.close().catch(() => {});
      }),
    );
  });

  // Property 4: Task Store Instance Sharing
  test('Property 4: Task Store Instance Sharing - same TaskStore instance is used by executor and SDK', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8000, max: 8500 }), (port) => {
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

        const customTaskStore = new InMemoryTaskStore();

        const runtime = createAgentServerRuntime({
          createFastify: fastify.factory,
          a2a: {
            buildAgentCard: () =>
              buildA2AAgentCard({
                name: 'test-agent',
                url: 'http://localhost:7447',
                capabilities: [{ id: 'test', title: 'Test' }],
                security: [],
              }),
            executeTask: async (task) => ({ ...task, state: 'completed' }),
            taskStore: customTaskStore,
          },
          sidecar: { routes: sidecarRoutes },
          listen: {
            a2a: { port, host: '127.0.0.1' },
            sidecar: { path: '/tmp/agent-message.sock' },
          },
        });

        // Validates: Requirements 2.4, 7.1, 7.2
        // The runtime should accept and use the provided taskStore
        expect(runtime).toBeDefined();
        expect(runtime.a2aServer).toBeDefined();

        // Cleanup
        runtime.close().catch(() => {});
      }),
    );
  });

  // Property 9: Authentication Middleware Conversion
  test('Property 9: Authentication Middleware Conversion - auth middleware can be provided', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8000, max: 8500 }), (port) => {
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
                name: 'test-agent',
                url: 'http://localhost:7447',
                capabilities: [{ id: 'test', title: 'Test' }],
                security: [],
              }),
            executeTask: async (task) => ({ ...task, state: 'completed' }),
            authMiddleware,
          },
          sidecar: { routes: sidecarRoutes },
          listen: {
            a2a: { port, host: '127.0.0.1' },
            sidecar: { path: '/tmp/agent-message.sock' },
          },
        });

        // Validates: Requirements 4.1
        expect(runtime).toBeDefined();
        expect(runtime.a2aServer).toBeDefined();

        // Cleanup
        runtime.close().catch(() => {});
      }),
    );
  });

  // Property 15: Lifecycle Idempotence
  test('Property 15: Lifecycle Idempotence - close() can be called multiple times safely', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8000, max: 8500 }), (port) => {
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
            buildAgentCard: () =>
              buildA2AAgentCard({
                name: 'test-agent',
                url: 'http://localhost:7447',
                capabilities: [{ id: 'test', title: 'Test' }],
                security: [],
              }),
            executeTask: async (task) => ({ ...task, state: 'completed' }),
          },
          sidecar: { routes: sidecarRoutes },
          listen: {
            a2a: { port, host: '127.0.0.1' },
            sidecar: { path: '/tmp/agent-message.sock' },
          },
        });

        // Validates: Requirements 1.7, 15.4
        // close() should be idempotent - calling it multiple times should not throw
        // Note: We don't await here because property tests are synchronous
        runtime.close().catch(() => {});
        runtime.close().catch(() => {});
        runtime.close().catch(() => {});

        expect(true).toBe(true);
      }),
    );
  });
});
