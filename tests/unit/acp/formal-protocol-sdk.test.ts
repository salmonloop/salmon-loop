import {
  AgentSideConnection,
  ClientSideConnection,
  type Agent,
  type Client,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'bun:test';

import { clearAuditTrail, getAuditTrail } from '../../../src/core/observability/audit-trail.js';
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

function expectConfigOptions(value: unknown): any[] {
  expect(Array.isArray(value)).toBe(true);
  return value as any[];
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

  it('negotiates unsupported protocol versions to the current supported ACP version', async () => {
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

    const initialized = await clientConn.initialize({
      protocolVersion: 0,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });

    expect(initialized.protocolVersion).toBe(1);
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

  it('rejects authenticate when no auth methods are advertised', async () => {
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

    const initialized = await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    expect(initialized.authMethods).toEqual([]);
    await expect(clientConn.authenticate({ methodId: 'oauth' })).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('rejects unsupported ACP extension requests instead of treating them as successful', async () => {
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

    await expect(clientConn.extMethod('example.com/unknown', {})).rejects.toMatchObject({
      code: -32601,
      data: { method: 'example.com/unknown' },
    });
  });

  it('emits session_info_update during session/new', async () => {
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });

    await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    const info = updates.find((u) => u.sessionUpdate === 'session_info_update');
    expect(info?.title).toBe('repo');
    expect(typeof info?.updatedAt).toBe('string');
    expect(Number.isFinite(Date.parse(info.updatedAt))).toBe(true);
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
    const configOptions = expectConfigOptions(res.configOptions);
    expect(configOptions.find((o: any) => o.id === '_salmonloop_mode')?.currentValue).toBe(
      'autopilot',
    );
    expect(Object.prototype.hasOwnProperty.call(res, 'sessionId')).toBe(false);
    expect(Array.isArray(updates)).toBe(true);
  });

  it('defaults ACP session mode to autopilot and exposes flow-backed modes', async () => {
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
    expect(response.modes?.currentModeId).toBe('autopilot');
    expect(response.modes?.availableModes.map((mode: any) => mode.id)).toEqual([
      'patch',
      'review',
      'debug',
      'research',
      'answer',
      'autopilot',
    ]);
    expect(configOptions.find((opt: any) => opt.id === '_salmonloop_mode')).toMatchObject({
      currentValue: 'autopilot',
      options: [
        { value: 'patch' },
        { value: 'review' },
        { value: 'debug' },
        { value: 'research' },
        { value: 'answer' },
        { value: 'autopilot' },
      ],
    });
    expect(
      configOptions.find((opt: any) => opt.id === '_salmonloop_permission_policy'),
    ).toMatchObject({
      currentValue: 'ask',
      options: [{ value: 'ask' }, { value: 'deny_all' }, { value: 'allow_all' }],
    });
  });

  it('supports allow_all as an explicit default ACP permission policy', async () => {
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          defaultPermissionPolicy: 'allow_all',
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
    expect(
      configOptions.find((opt: any) => opt.id === '_salmonloop_permission_policy'),
    ).toMatchObject({
      currentValue: 'allow_all',
    });
  });

  it('emits session_info_update at prompt start and end', async () => {
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
    updates.length = 0;

    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] });

    const infoUpdates = updates.filter((u) => u.sessionUpdate === 'session_info_update');
    expect(infoUpdates.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes latest checkpoint id in session/load _meta when checkpoint reader is provided', async () => {
    clearAuditTrail();
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          checkpointReader: {
            listBySession: async () => [
              {
                id: 'cp-latest',
                createdAt: '2026-03-04T00:00:00.000Z',
                strategy: 'worktree',
                backend: 'git_snapshot',
              },
            ],
            getById: async ({ checkpointId }) =>
              checkpointId === 'cp-latest'
                ? {
                    id: 'cp-latest',
                    createdAt: '2026-03-04T00:00:00.000Z',
                    strategy: 'worktree',
                    backend: 'git_snapshot',
                  }
                : null,
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
    expect((res as any)?._meta?.salmonloop?.checkpoint).toMatchObject({
      id: 'cp-latest',
      createdAt: '2026-03-04T00:00:00.000Z',
      strategy: 'worktree',
      backend: 'git_snapshot',
    });
    expect((res as any)?._meta?.salmonloop?.resumeProbe).toMatchObject({
      checkpointId: 'cp-latest',
      valid: true,
    });
    expect((res as any)?._meta?.salmonloop?.resumeHint).toBeNull();
    expect((res as any)?._meta?.salmonloop?.resumeHintCode).toBeNull();
    expect(getAuditTrail().some((event) => event.action === 'acp.checkpoint.read')).toBe(true);
  });

  it('returns readable resume hint when probe fails', async () => {
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          checkpointReader: {
            listBySession: async () => [{ id: 'cp-missing' }],
            probeById: async () => ({ valid: false, reason: 'manifest_lock_timeout' }),
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
    expect((res as any)?._meta?.salmonloop?.resumeReady).toBe(false);
    expect((res as any)?._meta?.salmonloop?.resumeHintCode).toBe(
      'CHECKPOINT_MANIFEST_LOCK_TIMEOUT',
    );
    expect(typeof (res as any)?._meta?.salmonloop?.resumeHint).toBe('string');
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

  it('still returns checkpoint _meta in session/new when loadSession capability is disabled', async () => {
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          capabilityPolicy: { loadSession: false },
          checkpointReader: {
            listBySession: async () => [{ id: 'cp-new' }],
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
    const res = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    expect((res as any)?._meta?.salmonloop?.latestCheckpointId).toBe('cp-new');
  });

  it('supports mode switching via session/set_config_option and emits current_mode_update', async () => {
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await expect(
      clientConn.setSessionConfigOption({
        sessionId,
        configId: '_salmonloop_mode',
        value: 'review',
      }),
    ).resolves.toBeDefined();

    expect(
      updates.some(
        (update) =>
          update?.sessionUpdate === 'current_mode_update' && update?.currentModeId === 'review',
      ),
    ).toBe(true);

    const res = await clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] });
    const configOptions = expectConfigOptions(res.configOptions);
    expect(configOptions.find((o: any) => o.id === '_salmonloop_mode')?.currentValue).toBe(
      'review',
    );
  });

  it('creates execution requests using the current ACP flow mode', async () => {
    const createTaskCalls: any[] = [];
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              createTaskCalls.push(input);
              return {
                task: {
                  id: 'task_1',
                  capability: input.capability,
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
    await clientConn.setSessionMode({ sessionId, modeId: 'debug' });
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] });

    expect(createTaskCalls).toHaveLength(1);
    expect(createTaskCalls[0]).toMatchObject({
      capability: 'debug',
      request: { instruction: 'hi', checkpointSessionId: sessionId, repoPath: '/repo' },
    });
  });

  it('degrades legacy live session mode updates to autopilot', async () => {
    const createTaskCalls: any[] = [];
    const updates: any[] = [];

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          defaultPermissionPolicy: 'allow_all',
          facade: {
            createTask: async (input: any) => {
              createTaskCalls.push(input);
              return {
                task: {
                  id: 'task_1',
                  capability: input.capability,
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
    await expect(
      clientConn.setSessionMode({ sessionId, modeId: 'interactive' as any }),
    ).resolves.toEqual({});
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] });

    expect(createTaskCalls).toHaveLength(1);
    expect(createTaskCalls[0]).toMatchObject({
      capability: 'autopilot',
    });
    expect(
      updates.some(
        (update) =>
          update.sessionUpdate === 'config_option_update' &&
          update.configOptions?.[0]?.id === '_salmonloop_permission_policy' &&
          update.configOptions?.[0]?.currentValue === 'ask',
      ),
    ).toBe(true);
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
    const configOptions = expectConfigOptions(response.configOptions);
    expect(configOptions.some((opt: any) => opt.id === '_salmonloop_mode')).toBe(true);
    expect(configOptions[0]).toMatchObject({
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

    const configOptions = expectConfigOptions(response.configOptions);
    expect(configOptions[0]).toMatchObject({
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

  it('degrades legacy mode config updates to autopilot instead of rejecting them', async () => {
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
    const response = await clientConn.setSessionConfigOption({
      sessionId,
      configId: '_salmonloop_mode',
      value: 'yolo',
    });

    const configOptions = expectConfigOptions(response.configOptions);
    expect(configOptions.find((opt: any) => opt.id === '_salmonloop_mode')).toMatchObject({
      currentValue: 'autopilot',
    });
    expect(
      configOptions.find((opt: any) => opt.id === '_salmonloop_permission_policy'),
    ).toMatchObject({
      currentValue: 'allow_all',
    });
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

  it('does not require terminal capability for local execution binding', async () => {
    let createTaskCalled = false;
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async () => {
              createTaskCalled = true;
              return {
                task: {
                  id: 'task_1',
                  capability: 'patch',
                  state: 'accepted',
                  request: { instruction: 'hi' },
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await expect(
      clientConn.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'hi' }],
      }),
    ).resolves.toBeDefined();
    expect(createTaskCalled).toBe(true);
  });

  it('uses local execution binding by default (no ACP command runner/filesystem)', async () => {
    let sawCommandRunner = false;
    let sawFileSystemOverride = false;
    let observedRepoPath: string | undefined;

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              sawCommandRunner = Boolean(input.commandRunner);
              sawFileSystemOverride = Boolean(input.fileSystemOverride);
              observedRepoPath = input.request?.repoPath;
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

    expect(sawCommandRunner).toBe(false);
    expect(sawFileSystemOverride).toBe(false);
    expect(observedRepoPath).toBe('/repo');
  });

  it('falls back to local binding when executionBinding=client but client capabilities are missing', async () => {
    let sawCommandRunner = false;
    let sawFileSystemOverride = false;
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          executionBinding: 'client',
          facade: {
            createTask: async (input: any) => {
              sawCommandRunner = Boolean(input.commandRunner);
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
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });

    await expect(
      clientConn.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'hi' }],
      }),
    ).resolves.toBeDefined();
    expect(sawCommandRunner).toBe(false);
    expect(sawFileSystemOverride).toBe(false);
  });

  it('can use ACP execution binding when explicitly enabled', async () => {
    let sawCommandRunner = false;
    let sawFileSystemOverride = false;

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          executionBinding: 'client',
          facade: {
            createTask: async (input: any) => {
              sawCommandRunner = Boolean(input.commandRunner);
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

    expect(sawCommandRunner).toBe(true);
    expect(sawFileSystemOverride).toBe(true);
  });

  it('emits non-empty available_commands_update during prompt', async () => {
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

    const available = updates.find((u) => u.sessionUpdate === 'available_commands_update');
    expect(Array.isArray(available?.availableCommands)).toBe(true);
    expect(available.availableCommands.length).toBeGreaterThan(0);
  });

  it('handles known ACP slash command without creating a task', async () => {
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

    expect(result.stopReason).toBe('end_turn');
    expect(updates.some((u) => u.sessionUpdate === 'agent_message_chunk')).toBe(true);
    expect(sawCreateTask).toBe(false);
  });

  it('passes through unknown slash commands to createTask', async () => {
    let sawCreateTask = false;
    let capturedInstruction = '';

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              sawCreateTask = true;
              capturedInstruction = input.request.instruction;
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
      prompt: [{ type: 'text', text: '/unknown' }],
    });

    expect(sawCreateTask).toBe(true);
    expect(capturedInstruction).toBe('/unknown');
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
    expect(start?.status).toBe('pending');
    expect(Array.isArray(start?.content)).toBe(true);
    expect(Array.isArray(end?.content)).toBe(true);
    expect(start?.rawInput).toEqual({ path: '/repo/README.md' });
    expect(start?.locations).toEqual([{ path: '/repo/README.md' }]);
    expect(end?.rawOutput).toBe('read /repo/README.md');
  });

  it('emits agent_thought_chunk for non-assistant LLM output kinds', async () => {
    const updates: any[] = [];

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              input.onEvent?.({
                type: 'llm.stream.delta',
                kind: 'review',
                step: 'REVIEW',
                streamId: 'stream_1',
                content: 'internal reasoning',
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

    expect(
      updates.some(
        (u) =>
          u.sessionUpdate === 'agent_thought_chunk' &&
          u.content?.type === 'text' &&
          u.content?.text?.includes('internal reasoning'),
      ),
    ).toBe(true);
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

  it('emits available_commands_update and current_mode_update during prompt', async () => {
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
                type: 'log',
                level: 'error',
                message: 'technical error',
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

    expect(updates.some((update) => update.sessionUpdate === 'plan')).toBe(false);
    expect(updates.some((update) => update.sessionUpdate === 'available_commands_update')).toBe(
      true,
    );
    // Technical phases should not be emitted as chat chunks
    expect(
      updates.some(
        (u) =>
          u.sessionUpdate === 'agent_message_chunk' &&
          JSON.stringify(u.content).includes('Starting'),
      ),
    ).toBe(false);
    // Logs should not be emitted as chat chunks
    expect(
      updates.some(
        (u) =>
          u.sessionUpdate === 'agent_message_chunk' &&
          JSON.stringify(u.content).includes('technical error'),
      ),
    ).toBe(false);

    const hasCurrentModeUpdate = updates.some(
      (update) =>
        update.sessionUpdate === 'current_mode_update' && update.currentModeId === 'autopilot',
    );
    expect(hasCurrentModeUpdate).toBe(true);
  });

  it('does not map internal phases into ACP plan updates', async () => {
    const updates: any[] = [];

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              for (const phase of ['PREFLIGHT', 'PREPARE_DEPS', 'CONTEXT', 'EXPLORE']) {
                input.onEvent?.({
                  type: 'phase.start',
                  phase,
                  timestamp: new Date(),
                });
                input.onEvent?.({
                  type: 'phase.end',
                  phase,
                  success: true,
                  timestamp: new Date(),
                });
              }
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

    expect(updates.some((update) => update.sessionUpdate === 'plan')).toBe(false);
  });

  it('projects ACP plan updates from core runtime plan file events', async () => {
    const updates: any[] = [];
    const readBySessionCalls: Array<{ repoPath: string; sessionId: string }> = [];
    const readBySession = async ({
      repoPath,
      sessionId,
    }: {
      repoPath: string;
      sessionId: string;
    }) => {
      readBySessionCalls.push({ repoPath, sessionId });
      return {
        sessionId: 'plan_sess_1',
        baseHash: 'hash_v1',
        active: [{ stepId: '1', text: '! Implement adapter bridge' }],
        pending: [{ stepId: '2', text: '· Add protocol tests' }],
        recentDone: [{ stepId: '3', text: '‐ Write design doc' }],
      };
    };

    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          planReader: { readBySession },
          facade: {
            createTask: async (input: any) => {
              input.onEvent?.({
                type: 'plan.runtime.ready',
                sessionId: 'plan_sess_1',
                planPathHint: '.salmonloop/plans/plan_sess_1/SALMONLOOP_PLAN.md',
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

    expect(readBySessionCalls).toEqual([{ repoPath: '/repo', sessionId: 'plan_sess_1' }]);
    const planUpdate = updates.find((update) => update.sessionUpdate === 'plan');
    expect(planUpdate).toBeTruthy();
    expect(planUpdate.entries).toEqual([
      { content: 'Implement adapter bridge', status: 'in_progress', priority: 'high' },
      { content: 'Add protocol tests', status: 'pending', priority: 'medium' },
      { content: 'Write design doc', status: 'completed', priority: 'low' },
    ]);
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

  it('advertises ACP capabilities backed by the runtime', async () => {
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

    const response = await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    expect(response.agentCapabilities?.sessionCapabilities).toMatchObject({
      list: {},
      resume: {},
      close: {},
    });
    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(response.agentCapabilities?.mcpCapabilities).toMatchObject({
      http: true,
      sse: false,
      acp: false,
    });
    expect(response.agentCapabilities?.promptCapabilities).toMatchObject({
      image: false,
      audio: false,
      embeddedContext: false,
    });
  });

  it('rejects non-empty additionalDirectories when multi-root workspace support is not advertised', async () => {
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

    const initialized = await clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    expect(
      initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories,
    ).toBeUndefined();
    await expect(
      clientConn.newSession({
        cwd: '/repo',
        mcpServers: [],
        additionalDirectories: ['/extra'],
      }),
    ).rejects.toMatchObject({ code: -32602 });

    const { sessionId } = await clientConn.newSession({
      cwd: '/repo',
      mcpServers: [],
      additionalDirectories: [],
    });
    await expect(
      clientConn.loadSession({
        sessionId,
        cwd: '/repo',
        mcpServers: [],
        additionalDirectories: ['/extra'],
      }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      clientConn.resumeSession({
        sessionId,
        cwd: '/repo',
        additionalDirectories: ['/extra'],
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('lists existing sessions and filters by cwd', async () => {
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

    const first = await clientConn.newSession({ cwd: '/repo-a', mcpServers: [] });
    const second = await clientConn.newSession({ cwd: '/repo-b', mcpServers: [] });

    const all = await clientConn.listSessions({});
    expect(all.sessions.map((session) => session.sessionId).sort()).toEqual(
      [first.sessionId, second.sessionId].sort(),
    );

    const filtered = await clientConn.listSessions({ cwd: '/repo-b' });
    expect(filtered.sessions).toEqual([
      expect.objectContaining({
        sessionId: second.sessionId,
        cwd: '/repo-b',
        title: 'repo-b',
      }),
    ]);
  });

  it('rejects session/list when cwd filter is not absolute', async () => {
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

    await expect(clientConn.listSessions({ cwd: 'relative/path' })).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('resumes a session without replaying previous messages', async () => {
    const updates: any[] = [];
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async () => ({
              task: {
                id: 'task_1',
                capability: 'patch',
                state: 'accepted',
                request: { instruction: 'remember this' },
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
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'remember this' }] });

    updates.length = 0;
    const resumed = await clientConn.resumeSession({ sessionId, cwd: '/repo' });

    expect(expectConfigOptions(resumed.configOptions).length).toBeGreaterThan(0);
    expect(resumed.modes?.currentModeId).toBe('autopilot');
    expect(
      updates.some(
        (update) =>
          update.sessionUpdate === 'agent_message_chunk' ||
          update.sessionUpdate === 'user_message_chunk',
      ),
    ).toBe(false);
    expect(updates.some((update) => update.sessionUpdate === 'session_info_update')).toBe(true);
  });

  it('rejects loading or resuming a session from a different cwd', async () => {
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
    const { sessionId } = await clientConn.newSession({ cwd: '/repo-a', mcpServers: [] });

    await expect(
      clientConn.loadSession({ sessionId, cwd: '/repo-b', mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(clientConn.resumeSession({ sessionId, cwd: '/repo-b' })).rejects.toMatchObject({
      code: -32602,
    });
    const listed = await clientConn.listSessions({});
    expect(listed.sessions).toContainEqual(expect.objectContaining({ sessionId, cwd: '/repo-a' }));
  });

  it('replays user and assistant text when loading a session', async () => {
    const updates: any[] = [];
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async () => ({
              task: {
                id: 'task_1',
                capability: 'patch',
                state: 'accepted',
                request: { instruction: 'hello' },
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
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hello' }] });

    updates.length = 0;
    await clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] });

    expect(
      updates.some(
        (update) =>
          update.sessionUpdate === 'user_message_chunk' && update.content?.text === 'hello',
      ),
    ).toBe(true);
    expect(
      updates.some(
        (update) =>
          update.sessionUpdate === 'agent_message_chunk' &&
          String(update.content?.text ?? '').includes('Task completed.'),
      ),
    ).toBe(true);
  });

  it('closes a session by cancelling work and removing it from session/list', async () => {
    const cancelledTasks: string[] = [];
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async () => ({
              task: {
                id: 'task_close_1',
                capability: 'patch',
                state: 'accepted',
                request: { instruction: 'long' },
                createdAt: new Date().toISOString(),
                attempt: 1,
              },
              signal: new AbortController().signal,
            }),
            getTask: async () => null,
            cancelTask: async (taskId: string) => {
              cancelledTasks.push(taskId);
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
    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'long' }] });

    await clientConn.closeSession({ sessionId });

    expect(cancelledTasks).toEqual(['task_close_1']);
    const listed = await clientConn.listSessions({});
    expect(listed.sessions.some((session) => session.sessionId === sessionId)).toBe(false);
    await expect(clientConn.resumeSession({ sessionId, cwd: '/repo' })).rejects.toMatchObject({
      code: -32004,
    });
  });

  it('passes ACP MCP session servers into task execution extensions', async () => {
    let observedExtensions: any;
    const { clientConn } = createConnectedPair({
      toAgent: (conn) =>
        createAcpFormalAgent({
          conn,
          agentInfo: { name: 'salmon-loop', version: '0.2.0' },
          facade: {
            createTask: async (input: any) => {
              observedExtensions = input.extensions;
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
    const { sessionId } = await clientConn.newSession({
      cwd: '/repo',
      mcpServers: [
        { name: 'local-tools', command: 'tool-server', args: ['--stdio'], env: [] },
        {
          type: 'http',
          name: 'remote-tools',
          url: 'http://127.0.0.1:8080/mcp',
          headers: [{ name: 'authorization', value: 'Bearer token' }],
        },
      ],
    });

    await clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'use tools' }] });

    expect(observedExtensions?.mcpServers).toEqual([
      expect.objectContaining({
        name: 'local-tools',
        transport: 'stdio',
        command: 'tool-server',
        args: ['--stdio'],
        env: {},
        allowTools: ['*'],
      }),
      expect.objectContaining({
        name: 'remote-tools',
        transport: 'http',
        url: 'http://127.0.0.1:8080/mcp',
        headers: { authorization: 'Bearer token' },
        allowTools: ['*'],
      }),
    ]);
  });

  it('rejects unsupported ACP MCP transports during session setup', async () => {
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

    await expect(
      clientConn.newSession({
        cwd: '/repo',
        mcpServers: [
          {
            type: 'sse',
            name: 'legacy-sse',
            url: 'http://127.0.0.1:8080/sse',
            headers: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: -32602 });

    const { sessionId } = await clientConn.newSession({ cwd: '/repo', mcpServers: [] });
    await expect(
      clientConn.resumeSession({
        sessionId,
        cwd: '/repo',
        mcpServers: [
          {
            type: 'acp',
            name: 'component-tools',
            id: 'component-tools-1',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      clientConn.loadSession({
        sessionId,
        cwd: '/repo',
        mcpServers: [
          {
            type: 'sse',
            name: 'legacy-sse',
            url: 'http://127.0.0.1:8080/sse',
            headers: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});
