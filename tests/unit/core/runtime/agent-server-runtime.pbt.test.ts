import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import { describe, expect, test } from 'bun:test';
import type { Express } from 'express';
import * as fc from 'fast-check';

import { buildA2AAgentCard } from '../../../../src/core/protocols/a2a/agent-card.js';

type AgentServerRuntimeModule =
  typeof import('../../../../src/core/runtime/agent-server-runtime.ts');

async function createRuntime(port: number, options?: { taskStore?: InMemoryTaskStore }) {
  const { createAgentServerRuntime } = (await import(
    `../../../../src/core/runtime/agent-server-runtime.ts?runtime-test=${Date.now()}-${Math.random()}`
  )) as AgentServerRuntimeModule;

  return createAgentServerRuntime({
    a2a: {
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'test-agent',
          url: 'http://localhost:7447/a2a/jsonrpc',
          capabilities: [{ id: 'autopilot', title: 'Autopilot' }],
          security: [],
        }),
      executeTask: async (task) => ({ ...task, state: 'completed' }),
      taskStore: options?.taskStore,
    },
    listen: {
      a2a: { port, host: '127.0.0.1' },
    },
  });
}

describe('agent server runtime - property-based tests', () => {
  test('runtime always exposes an Express A2A server and no sidecar server', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 8000, max: 8500 }), async (port) => {
        const runtime = await createRuntime(port);

        expect(typeof (runtime.a2aServer as Express).use).toBe('function');
        expect('sidecarServer' in runtime).toBe(false);

        await runtime.close();
      }),
    );
  });

  test('runtime accepts custom task stores', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 8000, max: 8500 }), async (port) => {
        const taskStore = new InMemoryTaskStore();
        const runtime = await createRuntime(port, { taskStore });

        expect(runtime.a2aServer).toBeDefined();

        await runtime.close();
      }),
    );
  });

  test('close() remains idempotent across generated ports', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 8000, max: 8500 }), async (port) => {
        const runtime = await createRuntime(port);

        await runtime.close();
        await runtime.close();
        await runtime.close();

        expect(true).toBe(true);
      }),
    );
  });
});
