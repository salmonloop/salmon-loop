import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('prunes stale sessions during hydration', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-prune-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');
    const oldTs = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString();
    const freshTs = new Date().toISOString();

    try {
      await mkdir(path.dirname(persistencePath), { recursive: true });
      await writeFile(
        persistencePath,
        JSON.stringify(
          {
            schemaVersion: 1,
            sessions: [
              {
                id: 'sess_old',
                cwd: '/repo',
                mcpServers: [],
                createdAt: oldTs,
                updatedAt: oldTs,
              },
              {
                id: 'sess_fresh',
                cwd: '/repo',
                mcpServers: [],
                createdAt: freshTs,
                updatedAt: freshTs,
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      const pair = createConnectedPair({
        toAgent: (conn) =>
          createAcpFormalAgent({
            conn,
            agentInfo: { name: 'salmon-loop', version: '0.2.0' },
            facade: createFacade(),
            sessionPersistencePath: persistencePath,
          }),
        toClient: () => createClient(),
      });
      await pair.clientConn.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });

      await expect(
        pair.clientConn.loadSession({ sessionId: 'sess_old', cwd: '/repo', mcpServers: [] }),
      ).rejects.toMatchObject({ code: -32004 });
      const loaded = await pair.clientConn.loadSession({
        sessionId: 'sess_fresh',
        cwd: '/repo',
        mcpServers: [],
      });
      expect(Array.isArray(loaded.configOptions)).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
