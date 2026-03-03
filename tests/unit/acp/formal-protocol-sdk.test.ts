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

  it('returns sessionId for session/load response', async () => {
    const updates: any[] = [];

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
        sessionUpdate: async (params: any) => {
          updates.push(params);
        },
      }),
    });

    await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    const res = await clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] });
    expect(res).toMatchObject({ sessionId });
    expect(Array.isArray(updates)).toBe(true);
  });

  it('returns -32601 when session/set_mode is called but mode capability is not provided', async () => {
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

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await expect(
      clientConn.setSessionMode({ sessionId, modeId: 'worktree' }),
    ).rejects.toMatchObject({ code: -32601 });
  });

  it('includes configOptions in session/new response', async () => {
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
    expect(response.configOptions).toBeArray();
    expect(response.configOptions?.[0]).toMatchObject({
      type: 'select',
      id: '_salmonloop_permission_policy',
      currentValue: 'ask',
    });
  });

  it('supports session/set_config_option and emits config_option_update', async () => {
    const updates: any[] = [];

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
        sessionUpdate: async (params: any) => {
          updates.push(params.update);
        },
      }),
    });

    await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    const response = await clientConn.setSessionConfigOption({
      sessionId,
      configId: '_salmonloop_permission_policy',
      value: 'deny_all',
    });

    expect(response.configOptions[0]).toMatchObject({
      type: 'select',
      id: '_salmonloop_permission_policy',
      currentValue: 'deny_all',
    });
    expect(
      updates.some(
        (update) =>
          update.sessionUpdate === 'config_option_update' &&
          update.configOptions?.[0]?.currentValue === 'deny_all',
      ),
    ).toBe(true);
  });

  it('returns -32602 when session/set_config_option has unsupported configId', async () => {
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

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    await expect(
      clientConn.setSessionConfigOption({
        sessionId,
        configId: '_unsupported',
        value: 'x',
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'hi' }],
    });

    expect(sawCommandRunner).toBe(true);
  });

  it('fails session/prompt when clientCapabilities.fs.readTextFile is false', async () => {
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await expect(
      clientConn.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('passes an ACP-backed filesystem override into task execution', async () => {
    let sawFileSystemOverride = false;

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              sawFileSystemOverride = Boolean(input.fileSystemOverride);
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'hi' }],
    });

    expect(sawFileSystemOverride).toBe(true);
  });

  it('emits plan and available_commands_update session updates during prompt', async () => {
    const updates: any[] = [];

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              input.onEvent?.({
                type: 'phase.start',
                phase: 'PLAN',
                timestamp: new Date(),
              });
              input.onEvent?.({
                type: 'phase.end',
                phase: 'PLAN',
                success: true,
                timestamp: new Date(),
              });
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
        sessionUpdate: async (params: any) => {
          updates.push(params.update);
        },
      }),
    });

    await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'hi' }],
    });

    expect(updates.some((update) => update.sessionUpdate === 'plan')).toBe(true);
    expect(updates.some((update) => update.sessionUpdate === 'available_commands_update')).toBe(
      true,
    );
  });
});
