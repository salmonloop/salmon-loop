import {
  AgentSideConnection,
  ClientSideConnection,
  type Agent,
  type Client,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'bun:test';

import { createAcpFormalAgent } from '../../../src/core/protocols/acp/formal-agent.js';

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

describe('ACP formal protocol (SDK)', () => {
  it('returns -32602 when initialize.protocolVersion is missing', async () => {
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

    await expect(
      clientConn.initialize({
        protocolVersion: undefined as unknown as number,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('returns -32602 when session/new cwd is not absolute', async () => {
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });

    await expect(
      clientConn.newSession({
        cwd: 'relative/path',
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('fails session/prompt when clientCapabilities.terminal is false', async () => {
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async () => {
              throw new Error('should not be reached');
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await expect(
      clientConn.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('passes an ACP-backed command runner into task execution', async () => {
    let sawCommandRunner = false;

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              sawCommandRunner = Boolean(input.commandRunner);
              return {
                task: {
                  id: 'task_1',
                  capability: 'patch',
                  state: 'accepted',
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
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async () => {},
      }),
    });

    await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'hi' }],
    });

    expect(sawCommandRunner).toBe(true);
  });
});
