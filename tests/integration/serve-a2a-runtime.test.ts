import net from 'node:net';

import { JsonRpcTransport } from '@a2a-js/sdk/client';
import { describe, expect, test } from 'bun:test';

import { buildA2AAgentCard } from '../../src/core/protocols/a2a/agent-card.js';
import {
  selectPublicCapabilitiesForSurface,
  toA2APublicSkills,
} from '../../src/core/public-capabilities/projections.js';
import { buildPublicCapabilityRegistry } from '../../src/core/public-capabilities/registry.js';
import { createAgentServerRuntime } from '../../src/core/runtime/agent-server-runtime.ts';

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve an open port')));
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

function buildServeLikeRuntime(port: number) {
  const publicCapabilities = selectPublicCapabilitiesForSurface(
    'a2a',
    buildPublicCapabilityRegistry(),
  );
  const skills = toA2APublicSkills(publicCapabilities);

  return createAgentServerRuntime({
    a2a: {
      buildAgentCard: () =>
        buildA2AAgentCard({
          name: 'salmon-loop',
          url: `http://127.0.0.1:${port}/a2a/jsonrpc`,
          capabilities: skills,
          security: [],
        }),
      executeTask: async (task) => ({ ...task, state: 'completed' }),
    },
    listen: {
      a2a: { host: '127.0.0.1', port },
    },
  });
}

function createMessage(id: string) {
  return {
    kind: 'message' as const,
    messageId: id,
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'fix bug' }],
    contextId: id,
  };
}

describe('serve A2A runtime integration', () => {
  test('serves an autopilot-only agent card from the registry-projected runtime', async () => {
    const port = await getAvailablePort();
    const runtime = buildServeLikeRuntime(port);
    await runtime.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`);
      expect(response.ok).toBe(true);
      const payload = await response.json();

      expect(payload.url).toBeUndefined();
      expect(payload.protocolVersion).toBeUndefined();
      expect(payload.preferredTransport).toBeUndefined();
      expect(payload.additionalInterfaces).toBeUndefined();
      expect(payload.supportedInterfaces).toEqual([
        {
          url: `http://127.0.0.1:${port}/a2a/jsonrpc`,
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        },
      ]);
      expect(payload.skills).toEqual([
        {
          id: 'autopilot',
          name: 'Autopilot',
          description: 'Let the agent decide which actions and tools to use.',
          tags: [],
        },
      ]);
    } finally {
      await runtime.close();
    }
  });

  test('executes message/send over the real A2A protocol and persists autopilot capability', async () => {
    const port = await getAvailablePort();
    const runtime = buildServeLikeRuntime(port);
    await runtime.start();

    try {
      const transport = new JsonRpcTransport({ endpoint: `http://127.0.0.1:${port}/a2a/jsonrpc` });
      const result = await transport.sendMessage({
        message: createMessage('serve-msg-1'),
      });

      expect(result.kind).toBe('task');
      if (result.kind !== 'task') {
        throw new Error('expected task response');
      }
      expect(result.status.state).toBe('completed');

      const stored = await transport.getTask({ id: result.id });
      if (!stored) {
        throw new Error('missing stored task');
      }
      expect(stored.status.state).toBe('completed');
      expect(stored.metadata?.capability).toBe('autopilot');
    } finally {
      await runtime.close();
    }
  });
});
