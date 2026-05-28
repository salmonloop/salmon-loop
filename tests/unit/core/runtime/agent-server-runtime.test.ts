import { createServer } from 'node:net';

import { describe, expect, test } from 'bun:test';
import type { Express } from 'express';

import { createTaskEventBus } from '../../../../src/core/interaction/events/bus.js';
import { buildA2AAgentCard } from '../../../../src/core/protocols/a2a/agent-card.js';

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

async function createRuntime(
  port: number,
  options?: { eventBus?: ReturnType<typeof createTaskEventBus> },
) {
  const { createAgentServerRuntime } = (await import(
    `../../../../src/core/runtime/agent-server-runtime.ts?runtime-test=${Date.now()}-${Math.random()}`
  )) as AgentServerRuntimeModule;

  return createAgentServerRuntime({
    a2a: {
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: 'http://localhost:7447/a2a/jsonrpc',
          capabilities: [{ id: 'autopilot', title: 'Autopilot' }],
          security: [],
        }),
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      eventBus: options?.eventBus,
    },
    listen: {
      a2a: { host: '127.0.0.1', port },
    },
  });
}

describe('agent server runtime', () => {
  test('creates an A2A-only runtime', async () => {
    const runtime = createRuntime(await getOpenPort());
    const created = await runtime;

    expect(created).toBeDefined();
    expect(created.eventBus).toBeDefined();
    expect(typeof (created.a2aServer as Express).use).toBe('function');
    expect('sidecarServer' in created).toBe(false);
    expect(typeof created.start).toBe('function');
    expect(typeof created.close).toBe('function');

    await created.close();
  });

  test('starts the A2A server', async () => {
    const runtime = await createRuntime(await getOpenPort());

    await runtime.start();
    await runtime.close();

    expect(true).toBe(true);
  });

  test('close() is idempotent', async () => {
    const runtime = await createRuntime(await getOpenPort());

    await runtime.close();
    await runtime.close();
    await runtime.close();

    expect(true).toBe(true);
  });

  test('accepts a custom event bus', async () => {
    const eventBus = createTaskEventBus();
    const runtime = await createRuntime(await getOpenPort(), { eventBus });

    expect(runtime.eventBus).toBe(eventBus);

    await runtime.close();
  });
});
