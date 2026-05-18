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

describe('ACP checkpoint read integration', () => {
  it('loads latest checkpoint metadata after a prompt turn', async () => {
    const checkpointsBySession = new Map<string, { id: string; createdAt: string }>();

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          checkpointReader: {
            listBySession: async ({ sessionId }) => {
              const current = checkpointsBySession.get(sessionId);
              return current
                ? [
                    {
                      id: current.id,
                      createdAt: current.createdAt,
                      strategy: 'worktree',
                      backend: 'git_snapshot',
                    },
                  ]
                : [];
            },
            getById: async ({ checkpointId, repoPath }) => ({
              id: checkpointId,
              createdAt: new Date().toISOString(),
              strategy: 'worktree',
              backend: repoPath ? 'git_snapshot' : undefined,
            }),
          },
          facade: {
            createTask: async (input) => {
              if (input.request.checkpointSessionId) {
                checkpointsBySession.set(input.request.checkpointSessionId, {
                  id: `cp-${Date.now()}`,
                  createdAt: new Date().toISOString(),
                });
              }
              return {
                task: {
                  id: 'task_1',
                  capability: 'patch',
                  state: 'completed',
                  request: { instruction: input.request.instruction },
                  createdAt: new Date().toISOString(),
                  attempt: 1,
                },
                signal: new AbortController().signal,
              };
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
        requestPermission: async () => ({
          outcome: { outcome: 'selected' as const, optionId: 'allow_once' },
        }),
        sessionUpdate: async () => {},
      }),
    });

    await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hello' }] });

    const loaded = await clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] });
    expect((loaded as any)?._meta?.salmonloop?.latestCheckpointId).toContain('cp-');
    expect((loaded as any)?._meta?.salmonloop?.checkpoint?.strategy).toBe('worktree');
  });
});
