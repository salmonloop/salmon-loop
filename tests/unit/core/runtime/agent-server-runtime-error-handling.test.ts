import { createServer } from 'node:net';

import { describe, expect, test } from 'bun:test';

import { buildA2AAgentCard } from '../../../../src/core/protocols/a2a/agent-card.js';

type AgentServerRuntimeModule = typeof import('../../../../src/core/runtime/agent-server-runtime.ts');

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

async function createRuntime(
  port: number,
  options?: { authMiddleware?: any; configureA2A?: any },
) {
  const { createAgentServerRuntime } = (await import(
    `../../../../src/core/runtime/agent-server-runtime.ts?runtime-test=${Date.now()}-${Math.random()}`
  )) as AgentServerRuntimeModule;

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
    const runtime = await createRuntime(await getOpenPort(), {
      authMiddleware: (req: any, res: any, next: any) => {
        if (req.headers?.authorization === 'Bearer valid-token') {
          next();
          return;
        }
        res.status(401).json({ error: 'Unauthorized' });
      },
    });

    expect(runtime.a2aServer).toBeDefined();

    await runtime.close();
  });

  test('runs configureA2A before start', async () => {
    let configured = false;
    const runtime = await createRuntime(await getOpenPort(), {
      configureA2A: () => {
        configured = true;
      },
    });

    await runtime.start();
    await runtime.close();

    expect(configured).toBe(true);
  });
});
