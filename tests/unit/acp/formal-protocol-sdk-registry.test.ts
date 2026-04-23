import {
  AgentSideConnection,
  ClientSideConnection,
  type Agent,
  type Client,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  registryBuilds: 0,
  projectionInputs: [] as Array<string[]>,
  projectedModes: [
    {
      id: 'patch',
      name: 'Patch from projection',
      description: 'Projected patch mode.',
    },
    {
      id: 'autopilot',
      name: 'Autopilot from projection',
      description: 'Projected autopilot mode.',
    },
  ],
}))();

mock.module('../../../src/core/public-capabilities/registry.js', () => ({
  buildPublicCapabilityRegistry: mock(() => {
    hoisted.registryBuilds += 1;
    return [
      {
        id: 'patch',
        kind: 'flow_mode',
        target: 'patch',
        title: 'Patch code',
        description: 'Apply code changes with verification.',
        surfaces: { a2a: false, acp: true },
        reachability: 'reachable',
      },
      {
        id: 'autopilot',
        kind: 'flow_mode',
        target: 'autopilot',
        title: 'Autopilot',
        description: 'Let the agent decide which actions and tools to use.',
        surfaces: { a2a: true, acp: true },
        reachability: 'reachable',
      },
      {
        id: 'latent-review',
        kind: 'flow_mode',
        target: 'review',
        title: 'Review code',
        description: 'Inspect code and report findings without mutating files.',
        surfaces: { a2a: false, acp: true },
        reachability: 'latent',
      },
    ];
  }),
}));

mock.module('../../../src/core/public-capabilities/projections.js', () => ({
  toAcpPublicModes: mock((entries: Array<{ id: string }>) => {
    hoisted.projectionInputs.push(entries.map((entry) => entry.id));
    return hoisted.projectedModes;
  }),
}));

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

describe('ACP formal protocol registry projection', () => {
  beforeEach(() => {
    hoisted.registryBuilds = 0;
    hoisted.projectionInputs.length = 0;
    hoisted.projectedModes = [
      {
        id: 'patch',
        name: 'Patch from projection',
        description: 'Projected patch mode.',
      },
      {
        id: 'autopilot',
        name: 'Autopilot from projection',
        description: 'Projected autopilot mode.',
      },
    ];
  });

  afterAll(() => {
    mock.restore();
  });

  it('sources exposed ACP modes from the public capability registry projection', async () => {
    const formalAgentModulePath = `../../../src/core/protocols/acp/formal-agent.js?registry-projection-test`;
    const { createAcpFormalAgent } = await import(formalAgentModulePath);
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

    expect(hoisted.registryBuilds).toBeGreaterThan(0);
    expect(hoisted.projectionInputs).toEqual([['patch', 'autopilot', 'latent-review']]);
    expect(response.modes?.availableModes).toEqual(hoisted.projectedModes);
    expect(response.configOptions.find((opt: any) => opt.id === '_salmonloop_mode')).toMatchObject(
      {
        currentValue: 'autopilot',
        options: [
          {
            value: 'patch',
            name: 'Patch from projection',
            description: 'Projected patch mode.',
          },
          {
            value: 'autopilot',
            name: 'Autopilot from projection',
            description: 'Projected autopilot mode.',
          },
        ],
      },
    );
  });
});
