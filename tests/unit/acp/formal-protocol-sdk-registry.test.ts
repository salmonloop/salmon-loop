import {
  AgentSideConnection,
  ClientSideConnection,
  type Agent,
  type Client,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'bun:test';

import { createAcpFormalAgent } from '../../../src/core/protocols/acp/formal-agent.js';
import { toAcpPublicModes } from '../../../src/core/public-capabilities/projections.js';
import { buildPublicCapabilityRegistry } from '../../../src/core/public-capabilities/registry.js';

function createConnectedPair(params: {
  toAgent: (conn: AgentSideConnection) => Agent;
  toClient: (agent: Agent) => Client;
}) {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();

  const agentStream = ndJsonStream(agentToClient.writable, clientToAgent.readable);
  const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable);

  const agentConn = new AgentSideConnection(params.toAgent, agentStream);
  const clientConn = new ClientSideConnection(params.toClient, clientStream);

  return { agentConn, clientConn };
}

function expectConfigOptions(value: unknown): any[] {
  expect(Array.isArray(value)).toBe(true);
  return value as any[];
}

describe('ACP formal protocol registry projection', () => {
  it('matches the registry-backed ACP mode projection for session mode exposure', async () => {
    const expectedModes = toAcpPublicModes(buildPublicCapabilityRegistry());
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async () => {
              throw new Error('not used');
            },
            getTask: async () => null,
            cancelTask: async () => null,
            resumeTask: async () => null,
            retryTask: async () => null,
            reopenTask: async () => null,
            listTasks: async () => ({ items: [] }),
            submitInput: async () => null,
            getArtifact: async () => null,
          },
        }),
      toClient: () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async () => {},
      }),
    });

    await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const response = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    const configOptions = expectConfigOptions(response.configOptions);

    expect(response.modes?.availableModes).toEqual(expectedModes);
    expect(configOptions.find((opt: any) => opt.id === '_salmonloop_mode')).toMatchObject({
      currentValue: 'autopilot',
      options: expectedModes.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description,
      })),
    });
  });
});
