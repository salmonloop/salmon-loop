import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';

import { describe, expect, mock, test } from 'bun:test';
import type { Express, RequestHandler } from 'express';

import { buildA2AAgentCard } from '../../../../src/core/protocols/a2a/agent-card.js';
import type { CreateA2ASdkExpressAppOptions } from '../../../../src/core/protocols/a2a/sdk/server.js';

type AgentServerRuntimeModule =
  typeof import('../../../../src/core/runtime/agent-server-runtime.ts');

async function getOpenPort() {
  return await new Promise<number>((resolve, reject) => {
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

function createMockServer() {
  const server = new EventEmitter() as EventEmitter & {
    close: ReturnType<typeof mock<(callback?: (error?: Error) => void) => EventEmitter>>;
  };
  server.close = mock((callback?: (error?: Error) => void) => {
    callback?.();
    return server;
  });
  return server;
}

function createMockExpressApp(server: ReturnType<typeof createMockServer>): Express {
  return {
    listen: (() => server) as unknown as Express['listen'],
    use: mock(() => undefined) as unknown as Express['use'],
  } as unknown as Express;
}

async function createRuntime(
  port: number,
  options?: {
    authMiddleware?: RequestHandler;
    configureA2A?: (app: Express) => Promise<void> | void;
    createA2AServerApp?: (
      appOptions: CreateA2ASdkExpressAppOptions,
      server: ReturnType<typeof createMockServer>,
    ) => Express;
  },
) {
  const { createAgentServerRuntime } = (await import(
    `../../../../src/core/runtime/agent-server-runtime.ts?runtime-test=${Date.now()}-${Math.random()}`
  )) as AgentServerRuntimeModule;
  const mockServer = createMockServer();

  return createAgentServerRuntime({
    a2a: {
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'test-agent',
          url: 'http://localhost:7447',
          capabilities: [{ id: 'autopilot', title: 'Autopilot' }],
          security: [],
        }),
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      authMiddleware: options?.authMiddleware,
    },
    listen: {
      a2a: { host: '127.0.0.1', port },
    },
    configureA2A: options?.configureA2A,
    createA2AServerApp: options?.createA2AServerApp
      ? (appOptions) => options.createA2AServerApp!(appOptions, mockServer)
      : undefined,
  });
}

describe('agent server runtime - error handling scenarios', () => {
  test('throws when the A2A port is already bound', async () => {
    const port = await getOpenPort();
    const runtime1 = await createRuntime(port);
    const runtime2 = await createRuntime(port);

    await runtime1.start();

    await expect(runtime2.start()).rejects.toThrow();

    await runtime1.close();
    await runtime2.close();
  });

  test('accepts authentication middleware', async () => {
    let receivedAuthMiddleware: RequestHandler | undefined;
    const authMiddleware: RequestHandler = (req, res, next) => {
      if (req.headers?.authorization === 'Bearer valid-token') {
        next();
        return;
      }
      res.status(401).json({ error: 'Unauthorized' });
    };
    const runtime = await createRuntime(await getOpenPort(), {
      authMiddleware,
      createA2AServerApp: (appOptions, _server) => {
        receivedAuthMiddleware = appOptions.authMiddleware;
        return createMockExpressApp(createMockServer());
      },
    });

    expect(runtime.a2aServer).toBeDefined();
    expect(receivedAuthMiddleware).toBe(authMiddleware);

    await runtime.close();
  });

  test('runs configureA2A before start', async () => {
    const order: string[] = [];
    let server: ReturnType<typeof createMockServer> | undefined;
    const runtime = await createRuntime(await getOpenPort(), {
      configureA2A: () => {
        order.push('configure');
      },
      createA2AServerApp: (_appOptions, injectedServer) => {
        server = injectedServer;
        return {
          ...createMockExpressApp(injectedServer),
          listen: (() => {
            order.push('listen');
            return injectedServer;
          }) as unknown as Express['listen'],
        } as unknown as Express;
      },
    });

    const startPromise = runtime.start();
    queueMicrotask(() => {
      server?.emit('listening');
    });

    await startPromise;
    await runtime.close();

    expect(order).toEqual(['configure', 'listen']);
  });
});
