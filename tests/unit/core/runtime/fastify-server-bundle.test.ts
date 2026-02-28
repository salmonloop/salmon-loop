import { describe, expect, test } from 'bun:test';

import { createFastifyServerBundle } from '../../../../src/core/runtime/fastify-server-bundle.js';

type FakeListenOptions = { port?: number; host?: string; path?: string };

function createFastifyFactory() {
  const calls: string[] = [];
  const listenOptions: Record<string, FakeListenOptions[]> = {
    a2a: [],
    sidecar: [],
  };

  const factory = (input?: { name?: string }) => {
    const name = input?.name ?? 'unknown';
    return {
      async register(plugin: (instance: any) => Promise<void> | void) {
        calls.push(`${name}.register`);
        await plugin(this);
      },
      async listen(options: FakeListenOptions) {
        listenOptions[name]?.push(options);
        calls.push(`${name}.listen`);
      },
      async close() {
        calls.push(`${name}.close`);
      },
    };
  };

  return { factory, calls, listenOptions };
}

describe('fastify server bundle', () => {
  test('registers plugins, applies configure hooks, and listens on both endpoints', async () => {
    const fastify = createFastifyFactory();
    const events: string[] = [];

    const bundle = createFastifyServerBundle({
      createFastify: fastify.factory,
      a2aPlugin: async () => {
        events.push('a2a.plugin');
      },
      sidecarPlugin: async () => {
        events.push('sidecar.plugin');
      },
      configureA2A: async () => {
        events.push('a2a.configure');
      },
      configureSidecar: async () => {
        events.push('sidecar.configure');
      },
      a2aListen: { port: 9000, host: '127.0.0.1' },
      sidecarListen: { path: '/tmp/agent-message.sock' },
    });

    await bundle.start();

    expect(fastify.calls).toEqual([
      'a2a.register',
      'sidecar.register',
      'a2a.listen',
      'sidecar.listen',
    ]);
    expect(events).toEqual(['a2a.configure', 'a2a.plugin', 'sidecar.configure', 'sidecar.plugin']);
    expect(fastify.listenOptions.a2a).toEqual([{ port: 9000, host: '127.0.0.1' }]);
    expect(fastify.listenOptions.sidecar).toEqual([{ path: '/tmp/agent-message.sock' }]);
  });

  test('closes both servers', async () => {
    const fastify = createFastifyFactory();
    const bundle = createFastifyServerBundle({
      createFastify: fastify.factory,
      a2aPlugin: async () => undefined,
      sidecarPlugin: async () => undefined,
      a2aListen: { port: 9001 },
      sidecarListen: { path: '/tmp/agent-message.sock' },
    });

    await bundle.start();
    await bundle.close();

    expect(fastify.calls).toContain('a2a.close');
    expect(fastify.calls).toContain('sidecar.close');
  });
});
