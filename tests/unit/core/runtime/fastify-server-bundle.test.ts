import { describe, expect, test } from 'bun:test';

import { createFastifyServerBundle } from '../../../../src/core/runtime/fastify-server-bundle.js';

type FakeListenOptions = { port?: number; host?: string; path?: string };

function createFastifyFactory() {
  const calls: string[] = [];
  const listenOptions: FakeListenOptions[] = [];
  const servers: Array<{ route: () => void }> = [];

  const factory = () => {
    const index = servers.length;
    const server = {
      route: () => {},
      async register(plugin: (instance: any) => Promise<void> | void) {
        calls.push(`server${index}.register`);
        await plugin(this);
      },
      async listen(options: FakeListenOptions) {
        listenOptions.push(options);
        calls.push(`server${index}.listen`);
      },
      async close() {
        calls.push(`server${index}.close`);
      },
    };
    servers.push(server);
    return server;
  };

  return { factory, calls, listenOptions, servers };
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
      'server0.register',
      'server1.register',
      'server0.listen',
      'server1.listen',
    ]);
    expect(events).toEqual(['a2a.configure', 'a2a.plugin', 'sidecar.configure', 'sidecar.plugin']);
    expect(fastify.listenOptions).toEqual([
      { port: 9000, host: '127.0.0.1' },
      { path: '/tmp/agent-message.sock' },
    ]);
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

    expect(fastify.calls).toContain('server0.close');
    expect(fastify.calls).toContain('server1.close');
  });
});
