import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AgentSideConnection,
  ClientSideConnection,
  type Agent,
  type Client,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'bun:test';

import { createAcpFormalAgent } from '../../src/core/protocols/acp/formal-agent.js';

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

function createFacade() {
  return {
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
  };
}

function createClient() {
  return {
    requestPermission: async () => ({ outcome: { outcome: 'allow_once' as const } }),
    sessionUpdate: async () => {},
  };
}

describe('ACP session persistence integration', () => {
  it('restores session identity across agent restarts', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');
    let sessionId = '';

    try {
      const first = createConnectedPair({
        toAgent: (conn) =>
          createAcpFormalAgent({
            conn,
            agentInfo: { name: 'salmon-loop', version: '0.2.0' },
            facade: createFacade(),
            sessionPersistencePath: persistencePath,
          }),
        toClient: () => createClient(),
      });
      await first.clientConn.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      ({ sessionId } = await first.clientConn.newSession({ cwd: '/repo', mcpServers: [] }));

      const second = createConnectedPair({
        toAgent: (conn) =>
          createAcpFormalAgent({
            conn,
            agentInfo: { name: 'salmon-loop', version: '0.2.0' },
            facade: createFacade(),
            sessionPersistencePath: persistencePath,
          }),
        toClient: () => createClient(),
      });
      await second.clientConn.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      const loaded = await second.clientConn.loadSession({
        sessionId,
        cwd: '/repo',
        mcpServers: [],
      });
      expect(Array.isArray(loaded.configOptions)).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
