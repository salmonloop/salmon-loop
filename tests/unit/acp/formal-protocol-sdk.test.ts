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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    await expect(
      clientConn.newSession({
        cwd: 'relative/path',
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('returns schema-compliant payload for session/load response', async () => {
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    const res = await clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] });
    expect(Array.isArray(res.configOptions)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res, 'sessionId')).toBe(false);
    expect(Array.isArray(updates)).toBe(true);
  });

  it('exposes latest checkpoint id in session/load _meta when checkpoint reader is provided', async () => {
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          checkpointReader: {
            listBySession: async () => [{ id: 'cp-latest' }],
          },
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    const res = await clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] });
    expect((res as any)?._meta?.salmonloop?.latestCheckpointId).toBe('cp-latest');
  });

  it('can disable loadSession capability and reject session/load', async () => {
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          capabilityPolicy: { loadSession: false },
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

    const initialize = await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });
    expect(initialize.agentCapabilities?.loadSession).toBe(false);

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    await expect(
      clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] }),
    ).rejects.toMatchObject({
      code: -32601,
    });
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
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

  it('emits user_message_chunk and non-empty available_commands_update', async () => {
    const updates: any[] = [];

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => ({
              task: {
                id: 'task_1',
                capability: 'patch',
                state: 'accepted',
                request: { instruction: input.request.instruction },
                createdAt: new Date().toISOString(),
                attempt: 1,
              },
              signal: new AbortController().signal,
            }),
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
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] });

    expect(updates.some((u) => u.sessionUpdate === 'user_message_chunk')).toBe(true);
    const available = updates.find((u) => u.sessionUpdate === 'available_commands_update');
    expect(Array.isArray(available?.availableCommands)).toBe(true);
    expect(available.availableCommands.length).toBeGreaterThan(0);
  });

  it('handles ACP slash command without creating a task', async () => {
    let sawCreateTask = false;
    const updates: any[] = [];

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async () => {
              sawCreateTask = true;
              return {
                task: {
                  id: 'task_1',
                  capability: 'patch',
                  state: 'accepted',
                  request: { instruction: '' },
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
    const result = await clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: '/help' }],
    });

    expect(sawCreateTask).toBe(false);
    expect(result.stopReason).toBe('end_turn');
    expect(updates.some((u) => u.sessionUpdate === 'agent_message_chunk')).toBe(true);
  });

  it('includes content blocks in tool_call and tool_call_update', async () => {
    const updates: any[] = [];

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              input.onEvent?.({
                type: 'tool.call.start',
                callId: 'call_1',
                toolName: 'fs.read',
                phase: 'PLAN',
                round: 1,
                input: { path: '/repo/README.md' },
                timestamp: new Date(),
              });
              input.onEvent?.({
                type: 'tool.call.end',
                callId: 'call_1',
                toolName: 'fs.read',
                phase: 'PLAN',
                round: 1,
                status: 'ok',
                outputSummary: 'read /repo/README.md',
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
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] });

    const start = updates.find((u) => u.sessionUpdate === 'tool_call' && u.toolCallId === 'call_1');
    const end = updates.find(
      (u) => u.sessionUpdate === 'tool_call_update' && u.toolCallId === 'call_1',
    );
    expect(Array.isArray(start?.content)).toBe(true);
    expect(Array.isArray(end?.content)).toBe(true);
  });

  it('accepts resource_link prompt blocks and forwards them into instruction text', async () => {
    let capturedInstruction = '';

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              capturedInstruction = input.request.instruction;
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
      prompt: [
        { type: 'text', text: 'See resource:' },
        { type: 'resource_link', name: 'Spec', uri: 'file:///repo/spec.md' },
      ],
    });

    expect(capturedInstruction).toContain('file:///repo/spec.md');
  });

  it('rejects image prompt blocks when promptCapabilities.image is false', async () => {
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await expect(
      clientConn.prompt({
        sessionId,
        prompt: [
          { type: 'text', text: 'See image:' },
          { type: 'image', data: 'data', mimeType: 'image/png' },
        ],
      }),
    ).rejects.toMatchObject({ code: -32000 });
  });

  it('emits plan, available_commands_update and session_info_update during prompt', async () => {
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
    const hasSessionInfoUpdate = updates.some(
      (update) =>
        update.sessionUpdate === 'session_info_update' && typeof update.updatedAt === 'string',
    );
    expect(hasSessionInfoUpdate).toBe(true);
  });

  it('returns cancelled stopReason when receiving session/cancel during prompt', async () => {
    const listeners = new Set<(event: any) => void>();
    const eventBus = {
      subscribe: (listener: (event: any) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      list: () => [],
    };

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          eventBus: eventBus as any,
          facade: {
            createTask: async (input: any) => ({
              task: {
                id: 'task_cancel_1',
                capability: 'patch',
                state: 'accepted',
                request: { instruction: input.request.instruction },
                createdAt: new Date().toISOString(),
                attempt: 1,
              },
              signal: new AbortController().signal,
            }),
            getTask: async () => null,
            cancelTask: async () => {
              const event = {
                taskId: 'task_cancel_1',
                type: 'task.cancelled',
                timestamp: Date.now(),
              };
              for (const listener of listeners) listener(event);
              return null;
            },
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

    const promptPromise = clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'long running task' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await clientConn.cancel({ sessionId });

    const result = await promptPromise;
    expect(result.stopReason).toBe('cancelled');
  });

  it('returns cancelled stopReason even if terminal event is not task.cancelled after session/cancel', async () => {
    const listeners = new Set<(event: any) => void>();
    const eventBus = {
      subscribe: (listener: (event: any) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      list: () => [],
    };

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          eventBus: eventBus as any,
          facade: {
            createTask: async (input: any) => ({
              task: {
                id: 'task_cancel_2',
                capability: 'patch',
                state: 'accepted',
                request: { instruction: input.request.instruction },
                createdAt: new Date().toISOString(),
                attempt: 1,
              },
              signal: new AbortController().signal,
            }),
            getTask: async () => null,
            cancelTask: async () => {
              const event = {
                taskId: 'task_cancel_2',
                type: 'task.failed',
                timestamp: Date.now(),
              };
              for (const listener of listeners) listener(event);
              return null;
            },
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

    const promptPromise = clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'long running task' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await clientConn.cancel({ sessionId });

    const result = await promptPromise;
    expect(result.stopReason).toBe('cancelled');
  });

  it('surfaces task failure detail instead of generic completion text', async () => {
    const updates: any[] = [];
    const listeners = new Set<(event: any) => void>();
    const taskId = 'task_failed_1';
    const failureMessage = 'Langfuse ingestion unauthorized (HTTP 401)';

    const eventBus = {
      subscribe: (listener: (event: any) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      list: () => [],
    };

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          eventBus: eventBus as any,
          facade: {
            createTask: async (input: any) => {
              setTimeout(() => {
                const event = {
                  taskId,
                  type: 'task.failed',
                  timestamp: Date.now(),
                };
                for (const listener of listeners) listener(event);
              }, 0);
              return {
                task: {
                  id: taskId,
                  capability: 'patch',
                  state: 'accepted',
                  request: { instruction: input.request.instruction },
                  createdAt: new Date().toISOString(),
                  attempt: 1,
                },
                signal: new AbortController().signal,
              };
            },
            getTask: async () =>
              ({
                id: taskId,
                state: 'failed',
                failure: {
                  code: 'LOOP_FAILED',
                  category: 'infrastructure',
                  message: failureMessage,
                },
              }) as any,
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
        sessionUpdate: async ({ update }: any) => {
          updates.push(update);
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
      prompt: [{ type: 'text', text: 'trigger failure' }],
    });

    const agentTexts = updates
      .filter((u) => u?.sessionUpdate === 'agent_message_chunk' && u?.content?.type === 'text')
      .map((u) => String(u.content.text ?? ''));

    expect(agentTexts.some((line) => line.includes(`Task failed: ${failureMessage}`))).toBe(true);
    expect(agentTexts.some((line) => line.includes('Task completed.'))).toBe(false);
  });

  it('emits structured inputRequired meta for awaiting input', async () => {
    const updates: any[] = [];
    const events: any[] = [];
    const listeners = new Set<(event: any) => void>();
    let lastTaskId = 'task_1';

    const eventBus = {
      subscribe: (listener: (event: any) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      list: (taskId: string) => events.filter((e) => e.taskId === taskId),
    };

    const inputRequired = {
      type: 'question',
      reason: 'clarification',
      prompt: 'Pick one',
      responseFormat: 'json',
      questions: [
        {
          question: 'Which option?',
          header: 'Pick',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    };

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          eventBus: eventBus as any,
          facade: {
            createTask: async (input: any) => {
              lastTaskId = `task_${Date.now()}`;
              events.push({ type: 'task.awaiting_input', taskId: lastTaskId });
              return {
                task: {
                  id: lastTaskId,
                  capability: 'patch',
                  state: 'accepted',
                  request: { instruction: input.request.instruction },
                  createdAt: new Date().toISOString(),
                  attempt: 1,
                },
                signal: new AbortController().signal,
              };
            },
            getTask: async () =>
              ({
                id: lastTaskId,
                state: 'awaiting_input',
                inputRequired,
              }) as any,
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
        sessionUpdate: async ({ update }: any) => {
          updates.push(update);
        },
      }),
    });

    await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
    const { sessionId } = await clientConn.newSession({ cwd: '/tmp', mcpServers: [] });

    await clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'Ask a question' }],
    });

    const update = updates.find((u) => u?.sessionUpdate === 'agent_message_chunk');
    expect(update?._meta?.inputRequired).toMatchObject({
      ...inputRequired,
      responseFormat: 'json',
    });
    const resourceUpdate = updates.find(
      (u) => u?.sessionUpdate === 'agent_message_chunk' && u?.content?.type === 'resource',
    );
    const resourceBlock = resourceUpdate?.content;
    expect(resourceBlock?.resource?.mimeType).toBe('application/json');
    expect(resourceBlock?.resource?.uri).toBe('s8p://input-required');
    expect(JSON.parse(resourceBlock?.resource?.text ?? '{}')).toMatchObject({
      ...inputRequired,
      responseFormat: 'json',
    });
  });
});
