import { EventEmitter } from 'node:events';

import { describe, expect, test } from 'bun:test';
import type { Express } from 'express';

import { buildA2AAgentCard } from '../../../../src/core/protocols/a2a/agent-card.js';

type AgentServerRuntimeModule =
  typeof import('../../../../src/core/runtime/agent-server-runtime.ts');

function createMockServer() {
  const server = new EventEmitter() as EventEmitter & {
    close: (callback?: (error?: Error) => void) => EventEmitter;
  };
  server.close = (callback?: (error?: Error) => void) => {
    callback?.();
    return server;
  };
  return server;
}

function createMockExpressApp(server: ReturnType<typeof createMockServer>): Express {
  return {
    listen: (() => server) as unknown as Express['listen'],
  } as unknown as Express;
}

async function createRuntime(server: ReturnType<typeof createMockServer>) {
  const { createAgentServerRuntime } = (await import(
    `../../../../src/core/runtime/agent-server-runtime.ts?listen-contract=${Date.now()}-${Math.random()}`
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
    },
    listen: {
      a2a: { host: '127.0.0.1', port: 7447 },
    },
    createA2AServerApp: () => createMockExpressApp(server),
  });
}

describe('agent server runtime listen contract', () => {
  test('rejects start() when the underlying server emits error before listening', async () => {
    const server = createMockServer();
    const runtime = await createRuntime(server);
    const expectedError = new Error('listen failed');

    const startPromise = runtime.start();

    queueMicrotask(() => {
      server.emit('error', expectedError);
    });

    await expect(startPromise).rejects.toThrow('listen failed');
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listenerCount('listening')).toBe(0);

    await runtime.close();
  });

  test('resolves start() on listening and removes temporary listeners', async () => {
    const server = createMockServer();
    const runtime = await createRuntime(server);

    const startPromise = runtime.start();

    queueMicrotask(() => {
      server.emit('listening');
    });

    await expect(startPromise).resolves.toBeUndefined();
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listenerCount('listening')).toBe(0);

    await runtime.close();
  });

  test('rejects concurrent start() calls before startup completes', async () => {
    const server = createMockServer();
    const runtime = await createRuntime(server);

    const firstStart = runtime.start();
    const secondStart = runtime.start();

    queueMicrotask(() => {
      server.emit('listening');
    });

    await expect(secondStart).rejects.toThrow('Runtime already started');
    await expect(firstStart).resolves.toBeUndefined();

    await runtime.close();
  });

  test('propagates close() errors from the underlying server', async () => {
    const server = createMockServer();
    const runtime = await createRuntime(server);
    const closeError = new Error('close failed');

    server.close = (callback?: (error?: Error) => void) => {
      callback?.(closeError);
      return server;
    };

    const startPromise = runtime.start();

    queueMicrotask(() => {
      server.emit('listening');
    });

    await expect(startPromise).resolves.toBeUndefined();
    await expect(runtime.close()).rejects.toThrow('close failed');
  });
});
