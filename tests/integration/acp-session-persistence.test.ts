import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
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
    requestPermission: async () => ({
      outcome: { outcome: 'selected' as const, optionId: 'allow_once' },
    }),
    sessionUpdate: async () => {},
  };
}

function expectConfigOptions(value: unknown): any[] {
  expect(Array.isArray(value)).toBe(true);
  return value as any[];
}

describe('ACP session persistence integration', () => {
  async function runWriterInChildProcess(
    fixturePath: string,
    persistencePath: string,
    cwd: string,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fixturePath, persistencePath, cwd], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  it('keeps unused new sessions transient across agent restarts', async () => {
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
      const listed = await second.clientConn.listSessions({ cwd: '/repo' });
      expect(listed.sessions.some((session) => session.sessionId === sessionId)).toBe(false);
      await expect(
        second.clientConn.loadSession({
          sessionId,
          cwd: '/repo',
          mcpServers: [],
        }),
      ).rejects.toMatchObject({ code: -32004 });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('recovers legacy stored ACP modes as autopilot during hydration', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-legacy-mode-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');
    const now = new Date().toISOString();

    try {
      await mkdir(path.dirname(persistencePath), { recursive: true });
      await writeFile(
        persistencePath,
        JSON.stringify(
          {
            schemaVersion: 2,
            sessions: [
              {
                id: 'sess_interactive',
                cwd: '/repo',
                mcpServers: [],
                createdAt: now,
                updatedAt: now,
                permissionPolicy: 'ask',
                modeId: 'interactive',
              },
              {
                id: 'sess_yolo',
                cwd: '/repo',
                mcpServers: [],
                createdAt: now,
                updatedAt: now,
                permissionPolicy: 'deny_all',
                modeId: 'yolo',
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

      const interactive = await pair.clientConn.loadSession({
        sessionId: 'sess_interactive',
        cwd: '/repo',
        mcpServers: [],
      });
      const yolo = await pair.clientConn.loadSession({
        sessionId: 'sess_yolo',
        cwd: '/repo',
        mcpServers: [],
      });
      const interactiveConfigOptions = expectConfigOptions(interactive.configOptions);
      const yoloConfigOptions = expectConfigOptions(yolo.configOptions);

      expect(interactive.modes?.currentModeId).toBe('autopilot');
      expect(yolo.modes?.currentModeId).toBe('autopilot');
      expect(
        interactiveConfigOptions.find((opt: any) => opt.id === '_salmonloop_mode')?.currentValue,
      ).toBe('autopilot');
      expect(
        yoloConfigOptions.find((opt: any) => opt.id === '_salmonloop_mode')?.currentValue,
      ).toBe('autopilot');
      expect(
        yoloConfigOptions.find((opt: any) => opt.id === '_salmonloop_permission_policy')
          ?.currentValue,
      ).toBe('deny_all');
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

  it('restores recent assistant/user history across restarts', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-history-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');

    try {
      const first = createConnectedPair({
        toAgent: (conn) =>
          createAcpFormalAgent({
            conn,
            agentInfo: { name: 'salmon-loop', version: '0.2.0' },
            facade: {
              ...createFacade(),
              createTask: async () => ({
                task: {
                  id: 'task_1',
                  capability: 'patch',
                  state: 'completed',
                  request: { instruction: 'hello' },
                  createdAt: new Date().toISOString(),
                  attempt: 1,
                },
                signal: new AbortController().signal,
              }),
            },
            sessionPersistencePath: persistencePath,
          }),
        toClient: () => createClient(),
      });
      await first.clientConn.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      const { sessionId } = await first.clientConn.newSession({ cwd: '/repo', mcpServers: [] });
      await first.clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: 'hello' }] });

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

      const payload = JSON.parse(await readFile(persistencePath, 'utf8')) as {
        sessions: Array<{ id: string; history?: unknown[]; taskId?: string }>;
      };
      const restored = payload.sessions.find((entry) => entry.id === sessionId);
      expect(Array.isArray(restored?.history)).toBe(true);
      expect((restored?.history?.length ?? 0) > 0).toBe(true);
      expect(restored?.taskId).toBe('task_1');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps a closed unused session absent across agent restarts', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-close-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');

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
      const { sessionId } = await first.clientConn.newSession({ cwd: '/repo', mcpServers: [] });
      await first.clientConn.closeSession({ sessionId });

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

      const listed = await second.clientConn.listSessions({});
      expect(listed.sessions.some((session) => session.sessionId === sessionId)).toBe(false);
      await expect(
        second.clientConn.loadSession({ sessionId, cwd: '/repo', mcpServers: [] }),
      ).rejects.toMatchObject({ code: -32004 });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps a closed materialized session loadable across agent restarts', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-close-keep-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');

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
      const { sessionId } = await first.clientConn.newSession({ cwd: '/repo', mcpServers: [] });
      await first.clientConn.setSessionMode({ sessionId, modeId: 'review' });
      await first.clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: '/help' }] });
      await first.clientConn.closeSession({ sessionId });

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

      const listed = await second.clientConn.listSessions({ cwd: '/repo' });
      expect(listed.sessions).toContainEqual(
        expect.objectContaining({
          sessionId,
          cwd: '/repo',
        }),
      );
      const loaded = await second.clientConn.loadSession({
        sessionId,
        cwd: '/repo',
        mcpServers: [],
      });
      expect(Array.isArray(loaded.configOptions)).toBe(true);
      expect(loaded.modes?.currentModeId).toBe('review');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('reclaims corrupted stale session lock payload before persisting', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-lock-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');
    const lockPath = `${persistencePath}.lock`;

    try {
      await mkdir(path.dirname(lockPath), { recursive: true });
      await writeFile(lockPath, '{ invalid-json', 'utf8');
      const stale = new Date(Date.now() - 1000 * 90);
      await utimes(lockPath, stale, stale);

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
      const { sessionId } = await pair.clientConn.newSession({ cwd: '/repo', mcpServers: [] });
      await pair.clientConn.prompt({ sessionId, prompt: [{ type: 'text', text: '/help' }] });

      const payload = JSON.parse(await readFile(persistencePath, 'utf8')) as {
        schemaVersion: number;
        sessions: unknown[];
      };
      expect(payload.schemaVersion).toBe(2);
      expect(payload.sessions.length > 0).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('merges concurrent session writers into one persisted store', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-merge-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');

    try {
      const pairA = createConnectedPair({
        toAgent: (conn) =>
          createAcpFormalAgent({
            conn,
            agentInfo: { name: 'salmon-loop', version: '0.2.0' },
            facade: createFacade(),
            sessionPersistencePath: persistencePath,
          }),
        toClient: () => createClient(),
      });
      const pairB = createConnectedPair({
        toAgent: (conn) =>
          createAcpFormalAgent({
            conn,
            agentInfo: { name: 'salmon-loop', version: '0.2.0' },
            facade: createFacade(),
            sessionPersistencePath: persistencePath,
          }),
        toClient: () => createClient(),
      });

      await Promise.all([
        pairA.clientConn.initialize({
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        }),
        pairB.clientConn.initialize({
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        }),
      ]);

      const [{ sessionId: sessionA }, { sessionId: sessionB }] = await Promise.all([
        pairA.clientConn.newSession({ cwd: '/repoA', mcpServers: [] }),
        pairB.clientConn.newSession({ cwd: '/repoB', mcpServers: [] }),
      ]);
      await Promise.all([
        pairA.clientConn.prompt({ sessionId: sessionA, prompt: [{ type: 'text', text: '/help' }] }),
        pairB.clientConn.prompt({ sessionId: sessionB, prompt: [{ type: 'text', text: '/help' }] }),
      ]);

      const payload = JSON.parse(await readFile(persistencePath, 'utf8')) as {
        sessions: Array<{ id: string }>;
      };
      const ids = new Set(payload.sessions.map((entry) => entry.id));
      expect(ids.has(sessionA)).toBe(true);
      expect(ids.has(sessionB)).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves sessions across real child-process concurrent writers', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'salmonloop-acp-session-multiproc-'));
    const persistencePath = path.join(tempRoot, 'acp', 'sessions.v1.json');
    const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/acp-session-writer.ts');

    try {
      const [writerA, writerB] = await Promise.all([
        runWriterInChildProcess(fixturePath, persistencePath, '/repo-child-a'),
        runWriterInChildProcess(fixturePath, persistencePath, '/repo-child-b'),
      ]);
      expect(writerA.code).toBe(0);
      expect(writerB.code).toBe(0);
      expect(writerA.stderr.trim()).toBe('');
      expect(writerB.stderr.trim()).toBe('');

      const payload = JSON.parse(await readFile(persistencePath, 'utf8')) as {
        sessions: Array<{ id: string; cwd: string }>;
      };
      const cwdSet = new Set(payload.sessions.map((entry) => entry.cwd));
      expect(cwdSet.has('/repo-child-a')).toBe(true);
      expect(cwdSet.has('/repo-child-b')).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
