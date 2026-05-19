import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import {
  AGENT_METHODS,
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type McpServer,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'bun:test';

import { resolveBunExecutable } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

const PROJECT_ROOT = path.resolve(process.cwd());
const CLI_ENTRY = path.join(PROJECT_ROOT, 'src', 'cli', 'index.ts');
const REQUEST_TIMEOUT_MS = 5000;
const PROCESS_STOP_TIMEOUT_MS = 1500;

type AcpSdkServer = {
  clientConn: ClientSideConnection;
  updates: SessionNotification[];
  stderrText: () => string;
  stdoutText: () => string;
  stop: () => Promise<void>;
};

type AcpSdkServerOptions = {
  home?: string;
  client?: Partial<Client>;
};

type CliColorEnv = 'disabled' | 'default';

const helper = new RealFsTestHelper();
const servers: AcpSdkServer[] = [];

afterEach(async () => {
  const running = servers.splice(0);
  await Promise.allSettled(running.map((server) => server.stop()));
  await helper.cleanup();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  description: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ACP ${description}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function collectUtf8(readable: ReadableStream<Uint8Array>): Promise<string> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function createIsolatedCliEnv(
  options: { home?: string; colorEnv?: CliColorEnv } = {},
): Promise<NodeJS.ProcessEnv> {
  const dotenvDir = await helper.createTempDir('salmonloop-acp-dotenv-');
  const dotenvPath = path.join(dotenvDir, '.env');
  await writeFile(dotenvPath, '', 'utf8');

  const home = options.home ?? (await helper.createTempDir('salmonloop-acp-home-'));
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOTENV_CONFIG_PATH: dotenvPath,
    HOME: home,
    SALMONLOOP_API_KEY: '',
    SALMONLOOP_USER_CONFIG_HOME: home,
    S8P_API_KEY: '',
    USERPROFILE: home,
    [pathKey]: process.env[pathKey],
  };

  if (options.colorEnv === 'default') {
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
  } else {
    env.FORCE_COLOR = '0';
    env.NO_COLOR = '1';
  }

  return env;
}

function spawnAcpCli(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  options: { noColor?: boolean } = {},
): ChildProcessWithoutNullStreams {
  const args = [CLI_ENTRY, '--repo', repoPath, 'serve', 'acp'];
  if (options.noColor !== false) args.push('--no-color');

  return spawn(resolveBunExecutable(), args, {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function createTestClient(updates: SessionNotification[], overrides: Partial<Client> = {}): Client {
  return {
    ...overrides,
    requestPermission:
      overrides.requestPermission ?? (async () => ({ outcome: { outcome: 'cancelled' } })),
    sessionUpdate: async (params) => {
      updates.push(params);
      await overrides.sessionUpdate?.(params);
    },
  };
}

async function startAcpSdkServer(
  repoPath: string,
  options: AcpSdkServerOptions = {},
): Promise<AcpSdkServer> {
  const env = await createIsolatedCliEnv({ home: options.home });
  const child = spawnAcpCli(repoPath, env);
  const updates: SessionNotification[] = [];
  let stderr = '';
  let stdout = '';
  let stopped = false;

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const stdoutWeb = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
  const [clientReadable, captureReadable] = stdoutWeb.tee();
  const captureDone = collectUtf8(captureReadable)
    .then((text) => {
      stdout += text;
    })
    .catch((error) => {
      stderr += `\n[stdout capture failed] ${error instanceof Error ? error.message : String(error)}`;
    });
  const stdinWeb = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>;
  const stream = ndJsonStream(stdinWeb, clientReadable);
  const clientConn = new ClientSideConnection(
    () => createTestClient(updates, options.client),
    stream,
  );

  const closePromise = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });

  const server: AcpSdkServer = {
    clientConn,
    updates,
    stderrText: () => stderr,
    stdoutText: () => stdout,
    stop: async () => {
      if (stopped) return;
      stopped = true;

      if (!child.killed) {
        child.stdin.end();
      }

      const closed = await Promise.race([
        closePromise.then(() => true),
        sleep(PROCESS_STOP_TIMEOUT_MS).then(() => false),
      ]);
      if (!closed && !child.killed) {
        child.kill('SIGTERM');
        await Promise.race([closePromise, sleep(PROCESS_STOP_TIMEOUT_MS)]);
      }
      await captureDone;
    },
  };

  servers.push(server);
  return server;
}

function sessionUpdates(server: AcpSdkServer): SessionUpdate[] {
  return server.updates.map((notification) => notification.update);
}

function updateKinds(updates: SessionUpdate[]): string[] {
  return updates.map((update) => update.sessionUpdate);
}

function textUpdateContent(update: SessionUpdate): string | null {
  if (!('content' in update)) return null;
  const content = update.content;
  if (!content || Array.isArray(content)) return null;
  return content.type === 'text' ? content.text : null;
}

function configValue(options: SessionConfigOption[] | null | undefined, id: string): unknown {
  return options?.find((option) => option.id === id)?.currentValue;
}

function parseJsonRpcLines(stdout: string): any[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function byJsonRpcId(messages: any[], id: string | number): any {
  const message = messages.find((candidate) => candidate?.id === id);
  expect(message).toBeTruthy();
  return message;
}

async function initializeAcp(server: AcpSdkServer) {
  return withTimeout(
    server.clientConn.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    }),
    'initialize',
  );
}

async function newAcpSession(server: AcpSdkServer, repoPath: string, mcpServers: McpServer[] = []) {
  return withTimeout(server.clientConn.newSession({ cwd: repoPath, mcpServers }), 'session/new');
}

async function promptText(server: AcpSdkServer, sessionId: string, text: string) {
  return withTimeout(
    server.clientConn.prompt({
      sessionId,
      prompt: [{ type: 'text', text }],
    }),
    'session/prompt',
  );
}

function expectStdoutOnlyJsonRpc(stdout: string): void {
  const lines = stdout.trim().split('\n').filter(Boolean);

  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toContain('\u001b[');
    const message = JSON.parse(line);
    expect(message).toMatchObject({ jsonrpc: '2.0' });
  }
}

async function runRawAcpRequest(params: {
  repoPath: string;
  payload: string;
  colorEnv?: CliColorEnv;
  noColor?: boolean;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const env = await createIsolatedCliEnv({ colorEnv: params.colorEnv });
  const child = spawnAcpCli(params.repoPath, env, { noColor: params.noColor });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const closePromise = new Promise<{ exitCode: number | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ exitCode: code }));
  });

  child.stdin.write(params.payload);
  child.stdin.end();

  const closed = await Promise.race([closePromise, sleep(REQUEST_TIMEOUT_MS).then(() => null)]);
  if (closed === null) {
    child.kill('SIGTERM');
    throw new Error(`Timed out waiting for raw ACP response. stderr=${stderr}`);
  }

  return { stdout, stderr, exitCode: closed.exitCode };
}

describe('ACP stdio official SDK integration', () => {
  it(
    'negotiates capabilities with a real serve acp stdio process',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP SDK fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      const initialized = await withTimeout(
        server.clientConn.initialize({
          protocolVersion: 0,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
        }),
        'initialize',
      );

      expect(initialized.protocolVersion).toBe(1);
      expect(initialized.agentInfo?.name).toBe('salmon-loop');
      expect(initialized.authMethods).toEqual([]);
      expect(initialized.agentCapabilities?.loadSession).toBe(true);
      expect(initialized.agentCapabilities?.sessionCapabilities).toMatchObject({
        close: {},
        list: {},
        resume: {},
      });
      expect(initialized.agentCapabilities?.sessionCapabilities?.delete).toBeUndefined();
      expect(initialized.agentCapabilities?.sessionCapabilities?.fork).toBeUndefined();
      expect(
        initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories,
      ).toBeUndefined();
      expect(initialized.agentCapabilities?.providers).toBeUndefined();
      expect(initialized.agentCapabilities?.nes).toBeUndefined();

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'supports session lifecycle operations across the real stdio boundary',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'package.json', content: '{"name":"acp-fixture"}\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await withTimeout(
        server.clientConn.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
        }),
        'initialize',
      );

      const created = await withTimeout(
        server.clientConn.newSession({ cwd: repo.path, mcpServers: [] }),
        'session/new',
      );
      expect(typeof created.sessionId).toBe('string');
      expect(created.modes?.currentModeId).toBe('autopilot');
      expect(Array.isArray(created.configOptions)).toBe(true);

      const listed = await withTimeout(server.clientConn.listSessions({}), 'session/list');
      expect(listed.sessions).toEqual([
        expect.objectContaining({
          cwd: repo.path,
          sessionId: created.sessionId,
          title: path.basename(repo.path),
        }),
      ]);

      const filtered = await withTimeout(
        server.clientConn.listSessions({ cwd: repo.path }),
        'filtered session/list',
      );
      expect(filtered.sessions.map((session) => session.sessionId)).toEqual([created.sessionId]);

      const loaded = await withTimeout(
        server.clientConn.loadSession({
          cwd: repo.path,
          mcpServers: [],
          sessionId: created.sessionId,
        }),
        'session/load',
      );
      expect(loaded.modes?.currentModeId).toBe('autopilot');
      expect(Array.isArray(loaded.configOptions)).toBe(true);

      const resumed = await withTimeout(
        server.clientConn.resumeSession({
          cwd: repo.path,
          mcpServers: [],
          sessionId: created.sessionId,
        }),
        'session/resume',
      );
      expect(resumed.modes?.currentModeId).toBe('autopilot');
      expect(Array.isArray(resumed.configOptions)).toBe(true);

      await withTimeout(
        server.clientConn.closeSession({ sessionId: created.sessionId }),
        'session/close',
      );
      const afterClose = await withTimeout(
        server.clientConn.listSessions({ cwd: repo.path }),
        'session/list after close',
      );
      expect(afterClose.sessions).toEqual([]);
      expect(server.updates.length).toBeGreaterThan(0);

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'streams prompt updates from a real slash-command turn through the official SDK client',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP prompt fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);
      const created = await newAcpSession(server, repo.path);

      expect(updateKinds(sessionUpdates(server))).toEqual(
        expect.arrayContaining([
          'session_info_update',
          'available_commands_update',
          'current_mode_update',
        ]),
      );
      expect(
        sessionUpdates(server).some(
          (update) =>
            update.sessionUpdate === 'available_commands_update' &&
            update.availableCommands.some((command) => command.name === 'help'),
        ),
      ).toBe(true);
      expect(
        sessionUpdates(server).some(
          (update) =>
            update.sessionUpdate === 'current_mode_update' && update.currentModeId === 'autopilot',
        ),
      ).toBe(true);

      server.updates.length = 0;
      const response = await promptText(server, created.sessionId, '/help');

      expect(response.stopReason).toBe('end_turn');
      const updates = sessionUpdates(server);
      expect(updateKinds(updates)).toEqual(
        expect.arrayContaining(['session_info_update', 'agent_message_chunk']),
      );
      expect(
        updates.some((update) => {
          const content = textUpdateContent(update);
          return update.sessionUpdate === 'agent_message_chunk' && content?.includes('/help');
        }),
      ).toBe(true);

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'applies session configuration and mode changes through the real stdio process',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP config fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);
      const created = await newAcpSession(server, repo.path);

      server.updates.length = 0;
      const configResponse = await withTimeout(
        server.clientConn.setSessionConfigOption({
          sessionId: created.sessionId,
          configId: '_salmonloop_mode',
          value: 'review',
        }),
        'session/set_config_option',
      );
      expect(configValue(configResponse.configOptions, '_salmonloop_mode')).toBe('review');
      expect(
        sessionUpdates(server).some(
          (update) =>
            update.sessionUpdate === 'current_mode_update' && update.currentModeId === 'review',
        ),
      ).toBe(true);

      server.updates.length = 0;
      await withTimeout(
        server.clientConn.setSessionMode({ sessionId: created.sessionId, modeId: 'debug' }),
        'session/set_mode',
      );
      expect(
        sessionUpdates(server).some(
          (update) =>
            update.sessionUpdate === 'current_mode_update' && update.currentModeId === 'debug',
        ),
      ).toBe(true);

      const loaded = await withTimeout(
        server.clientConn.loadSession({
          cwd: repo.path,
          mcpServers: [],
          sessionId: created.sessionId,
        }),
        'session/load after mode change',
      );
      expect(loaded.modes?.currentModeId).toBe('debug');
      expect(configValue(loaded.configOptions, '_salmonloop_mode')).toBe('debug');

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'replays persisted conversation history when loading a real session',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP history fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);
      const created = await newAcpSession(server, repo.path);
      await promptText(server, created.sessionId, '/help');

      server.updates.length = 0;
      await withTimeout(
        server.clientConn.loadSession({
          cwd: repo.path,
          mcpServers: [],
          sessionId: created.sessionId,
        }),
        'session/load with history',
      );

      const updates = sessionUpdates(server);
      expect(
        updates.some(
          (update) =>
            update.sessionUpdate === 'user_message_chunk' && textUpdateContent(update) === '/help',
        ),
      ).toBe(true);
      expect(
        updates.some((update) => {
          const content = textUpdateContent(update);
          return update.sessionUpdate === 'agent_message_chunk' && content?.includes('/help');
        }),
      ).toBe(true);

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'keeps concurrent session creation isolated across the real stdio boundary',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP concurrent fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);

      const [first, second] = await Promise.all([
        newAcpSession(server, repo.path),
        newAcpSession(server, repo.path),
      ]);

      expect(first.sessionId).not.toBe(second.sessionId);

      await withTimeout(
        server.clientConn.setSessionConfigOption({
          sessionId: first.sessionId,
          configId: '_salmonloop_mode',
          value: 'review',
        }),
        'session/set_config_option on first concurrent session',
      );

      const [loadedFirst, loadedSecond] = await Promise.all([
        withTimeout(
          server.clientConn.loadSession({
            cwd: repo.path,
            mcpServers: [],
            sessionId: first.sessionId,
          }),
          'load first concurrent session',
        ),
        withTimeout(
          server.clientConn.loadSession({
            cwd: repo.path,
            mcpServers: [],
            sessionId: second.sessionId,
          }),
          'load second concurrent session',
        ),
      ]);

      expect(loadedFirst.modes?.currentModeId).toBe('review');
      expect(loadedSecond.modes?.currentModeId).toBe('autopilot');

      const listed = await withTimeout(
        server.clientConn.listSessions({ cwd: repo.path }),
        'session/list concurrent sessions',
      );
      expect(new Set(listed.sessions.map((session) => session.sessionId))).toEqual(
        new Set([first.sessionId, second.sessionId]),
      );

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 30000 },
  );

  it(
    'orders real session/list results by externally visible session updates',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP list ordering fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);
      const older = await newAcpSession(server, repo.path);
      const newer = await newAcpSession(server, repo.path);

      let listed = await withTimeout(
        server.clientConn.listSessions({ cwd: repo.path }),
        'session/list before update',
      );
      expect(listed.sessions.map((session) => session.sessionId)).toEqual([
        newer.sessionId,
        older.sessionId,
      ]);

      await withTimeout(
        server.clientConn.setSessionMode({ sessionId: older.sessionId, modeId: 'debug' }),
        'session/set_mode updates older session',
      );

      listed = await withTimeout(
        server.clientConn.listSessions({ cwd: repo.path }),
        'session/list after update',
      );
      expect(listed.sessions.map((session) => session.sessionId)).toEqual([
        older.sessionId,
        newer.sessionId,
      ]);
      expect(Date.parse(listed.sessions[0]!.updatedAt ?? '')).toBeGreaterThanOrEqual(
        Date.parse(listed.sessions[1]!.updatedAt ?? ''),
      );

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 30000 },
  );

  it(
    'persists sessions across real serve acp process restarts',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP persistence fixture\n' }],
      });
      const home = await helper.createTempDir('salmonloop-acp-shared-home-');
      const firstServer = await startAcpSdkServer(repo.path, { home });

      await initializeAcp(firstServer);
      const created = await newAcpSession(firstServer, repo.path);
      await promptText(firstServer, created.sessionId, '/help');
      await firstServer.stop();
      expectStdoutOnlyJsonRpc(firstServer.stdoutText());

      const secondServer = await startAcpSdkServer(repo.path, { home });
      await initializeAcp(secondServer);

      const listed = await withTimeout(
        secondServer.clientConn.listSessions({ cwd: repo.path }),
        'session/list after restart',
      );
      expect(listed.sessions).toEqual([
        expect.objectContaining({
          cwd: repo.path,
          sessionId: created.sessionId,
        }),
      ]);

      secondServer.updates.length = 0;
      const loaded = await withTimeout(
        secondServer.clientConn.loadSession({
          cwd: repo.path,
          mcpServers: [],
          sessionId: created.sessionId,
        }),
        'session/load after restart',
      );
      expect(loaded.modes?.currentModeId).toBe('autopilot');
      expect(
        sessionUpdates(secondServer).some(
          (update) =>
            update.sessionUpdate === 'user_message_chunk' && textUpdateContent(update) === '/help',
        ),
      ).toBe(true);

      await secondServer.stop();
      expectStdoutOnlyJsonRpc(secondServer.stdoutText());
    },
    { timeout: 30000 },
  );

  it(
    'persists configuration changes across real serve acp process restarts',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP config persistence fixture\n' }],
      });
      const home = await helper.createTempDir('salmonloop-acp-config-home-');
      const firstServer = await startAcpSdkServer(repo.path, { home });

      await initializeAcp(firstServer);
      const created = await newAcpSession(firstServer, repo.path);
      await withTimeout(
        firstServer.clientConn.setSessionConfigOption({
          sessionId: created.sessionId,
          configId: '_salmonloop_permission_policy',
          value: 'allow_all',
        }),
        'session/set_config_option permission policy before restart',
      );
      await withTimeout(
        firstServer.clientConn.setSessionMode({ sessionId: created.sessionId, modeId: 'review' }),
        'session/set_mode before restart',
      );
      await firstServer.stop();
      expectStdoutOnlyJsonRpc(firstServer.stdoutText());

      const secondServer = await startAcpSdkServer(repo.path, { home });
      await initializeAcp(secondServer);

      const loaded = await withTimeout(
        secondServer.clientConn.loadSession({
          cwd: repo.path,
          mcpServers: [],
          sessionId: created.sessionId,
        }),
        'session/load after config restart',
      );

      expect(loaded.modes?.currentModeId).toBe('review');
      expect(configValue(loaded.configOptions, '_salmonloop_mode')).toBe('review');
      expect(configValue(loaded.configOptions, '_salmonloop_permission_policy')).toBe('allow_all');

      await secondServer.stop();
      expectStdoutOnlyJsonRpc(secondServer.stdoutText());
    },
    { timeout: 30000 },
  );

  it(
    'keeps closed sessions absent across real serve acp process restarts',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP close persistence fixture\n' }],
      });
      const home = await helper.createTempDir('salmonloop-acp-close-home-');
      const firstServer = await startAcpSdkServer(repo.path, { home });

      await initializeAcp(firstServer);
      const created = await newAcpSession(firstServer, repo.path);
      await withTimeout(
        firstServer.clientConn.closeSession({ sessionId: created.sessionId }),
        'session/close before restart',
      );
      await firstServer.stop();
      expectStdoutOnlyJsonRpc(firstServer.stdoutText());

      const secondServer = await startAcpSdkServer(repo.path, { home });
      await initializeAcp(secondServer);

      const listed = await withTimeout(
        secondServer.clientConn.listSessions({ cwd: repo.path }),
        'session/list after closed restart',
      );
      expect(listed.sessions).toEqual([]);
      await expect(
        withTimeout(
          secondServer.clientConn.loadSession({
            cwd: repo.path,
            mcpServers: [],
            sessionId: created.sessionId,
          }),
          'session/load closed session after restart',
        ),
      ).rejects.toMatchObject({ code: -32004 });

      await secondServer.stop();
      expectStdoutOnlyJsonRpc(secondServer.stdoutText());
    },
    { timeout: 30000 },
  );

  it(
    'accepts supported MCP server params and rejects unsupported MCP transports at the real boundary',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP MCP fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);
      const created = await newAcpSession(server, repo.path, [
        { name: 'local-tools', command: 'tool-server', args: ['--stdio'], env: [] },
        {
          type: 'http',
          name: 'remote-tools',
          url: 'http://127.0.0.1:65535/mcp',
          headers: [{ name: 'authorization', value: 'Bearer token' }],
        },
      ]);
      const response = await promptText(server, created.sessionId, '/help');
      expect(response.stopReason).toBe('end_turn');

      await expect(
        withTimeout(
          server.clientConn.newSession({
            cwd: repo.path,
            mcpServers: [
              {
                type: 'sse',
                name: 'legacy-sse',
                url: 'http://127.0.0.1:65535/sse',
                headers: [],
              },
            ],
          }),
          'session/new with unsupported SSE MCP',
        ),
      ).rejects.toMatchObject({ code: -32602 });

      await expect(
        withTimeout(
          server.clientConn.resumeSession({
            cwd: repo.path,
            mcpServers: [
              {
                type: 'acp',
                name: 'component-tools',
                id: 'component-tools-1',
              },
            ],
            sessionId: created.sessionId,
          }),
          'session/resume with unsupported ACP MCP',
        ),
      ).rejects.toMatchObject({ code: -32602 });

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'rejects unadvertised ACP capabilities while preserving real sessions',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP unsupported capability fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      const initialized = await initializeAcp(server);
      expect(initialized.agentCapabilities?.sessionCapabilities?.delete).toBeUndefined();
      expect(initialized.agentCapabilities?.sessionCapabilities?.fork).toBeUndefined();
      expect(initialized.agentCapabilities?.providers).toBeUndefined();
      expect(initialized.agentCapabilities?.nes).toBeUndefined();

      const created = await newAcpSession(server, repo.path);

      await expect(
        withTimeout(
          server.clientConn.unstable_deleteSession({ sessionId: created.sessionId }),
          'unsupported session/delete',
        ),
      ).rejects.toMatchObject({ code: -32601, data: { method: AGENT_METHODS.session_delete } });
      await expect(
        withTimeout(
          server.clientConn.unstable_forkSession({
            cwd: repo.path,
            mcpServers: [],
            sessionId: created.sessionId,
          }),
          'unsupported session/fork',
        ),
      ).rejects.toMatchObject({ code: -32601, data: { method: AGENT_METHODS.session_fork } });
      await expect(
        withTimeout(
          server.clientConn.unstable_setSessionModel({
            modelId: 'model-from-client',
            sessionId: created.sessionId,
          }),
          'unsupported session/set_model',
        ),
      ).rejects.toMatchObject({ code: -32601, data: { method: AGENT_METHODS.session_set_model } });
      await expect(
        withTimeout(server.clientConn.unstable_listProviders({}), 'unsupported providers/list'),
      ).rejects.toMatchObject({ code: -32601, data: { method: AGENT_METHODS.providers_list } });
      await expect(
        withTimeout(
          server.clientConn.unstable_startNes({ workspaceUri: `file://${repo.path}` }),
          'unsupported nes/start',
        ),
      ).rejects.toMatchObject({ code: -32601, data: { method: AGENT_METHODS.nes_start } });

      const listed = await withTimeout(
        server.clientConn.listSessions({ cwd: repo.path }),
        'session/list after unsupported methods',
      );
      expect(listed.sessions.map((session) => session.sessionId)).toEqual([created.sessionId]);

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 30000 },
  );

  it(
    'ignores unadvertised document notifications without corrupting the real stdio session',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP document fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);
      const created = await newAcpSession(server, repo.path);

      await withTimeout(
        server.clientConn.unstable_didOpenDocument({
          sessionId: created.sessionId,
          uri: `file://${path.join(repo.path, 'README.md')}`,
          languageId: 'markdown',
          text: '# Edited in client\n',
          version: 1,
        }),
        'unsupported document/didOpen notification',
      );

      const response = await promptText(server, created.sessionId, '/help');
      expect(response.stopReason).toBe('end_turn');

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'honors a prior session/cancel notification on the next real prompt turn',
    async () => {
      const repo = await helper.createGitRepo({
        initialFiles: [{ path: 'README.md', content: '# ACP cancel fixture\n' }],
      });
      const server = await startAcpSdkServer(repo.path);

      await initializeAcp(server);
      const created = await newAcpSession(server, repo.path);

      await withTimeout(
        server.clientConn.cancel({ sessionId: created.sessionId }),
        'session/cancel',
      );
      const response = await promptText(server, created.sessionId, '/help');

      expect(response.stopReason).toBe('cancelled');
      expect(
        sessionUpdates(server).some((update) => update.sessionUpdate === 'session_info_update'),
      ).toBe(true);

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'surfaces protocol errors from the real stdio process through the official SDK client',
    async () => {
      const repo = await helper.createGitRepo();
      const server = await startAcpSdkServer(repo.path);

      await withTimeout(
        server.clientConn.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
        }),
        'initialize',
      );

      await expect(
        withTimeout(
          server.clientConn.authenticate({ methodId: 'oauth' }),
          'unsupported authenticate',
        ),
      ).rejects.toMatchObject({ code: -32602 });

      await expect(
        withTimeout(
          server.clientConn.extMethod('example.com/unknown', {}),
          'unsupported extension request',
        ),
      ).rejects.toMatchObject({
        code: -32601,
        data: { method: 'example.com/unknown' },
      });

      await expect(
        withTimeout(
          server.clientConn.newSession({
            additionalDirectories: [path.join(repo.path, 'extra')],
            cwd: repo.path,
            mcpServers: [],
          }),
          'unsupported additionalDirectories',
        ),
      ).rejects.toMatchObject({ code: -32602 });

      await server.stop();
      expectStdoutOnlyJsonRpc(server.stdoutText());
    },
    { timeout: 20000 },
  );

  it(
    'handles a final stdio JSON-RPC request without a trailing newline in the real process',
    async () => {
      const repo = await helper.createGitRepo();
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 0,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
        },
      });

      const result = await runRawAcpRequest({ repoPath: repo.path, payload });
      const messages = parseJsonRpcLines(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        id: 1,
        jsonrpc: '2.0',
        result: {
          protocolVersion: 1,
          authMethods: [],
          agentCapabilities: {
            sessionCapabilities: {
              close: {},
              list: {},
              resume: {},
            },
          },
        },
      });
      expect(result.stdout).not.toContain('\u001b[');
    },
    { timeout: 20000 },
  );

  it(
    'returns JSON-RPC protocol errors for malformed raw stdio input in the real process',
    async () => {
      const repo = await helper.createGitRepo();
      const result = await runRawAcpRequest({
        repoPath: repo.path,
        payload: 'not-json\n123\n',
      });

      expect(result.exitCode).toBe(0);
      expect(parseJsonRpcLines(result.stdout)).toEqual([
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid Request' },
        },
      ]);
      expect(result.stdout).not.toContain('\u001b[');
    },
    { timeout: 20000 },
  );

  it(
    'keeps stdout protocol-only when serve acp starts with default color handling',
    async () => {
      const repo = await helper.createGitRepo();
      const result = await runRawAcpRequest({
        repoPath: repo.path,
        payload: 'not-json\n123\n',
        colorEnv: 'default',
        noColor: false,
      });

      expect(result.exitCode).toBe(0);
      expect(parseJsonRpcLines(result.stdout)).toEqual([
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid Request' },
        },
      ]);
      expectStdoutOnlyJsonRpc(result.stdout);
    },
    { timeout: 20000 },
  );

  it(
    'normalizes omitted raw JSON-RPC params before reaching the real ACP handler',
    async () => {
      const repo = await helper.createGitRepo();
      const payload = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
              terminal: true,
            },
          },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'session/list',
        },
      ]
        .map((message) => JSON.stringify(message))
        .join('\n');

      const result = await runRawAcpRequest({ repoPath: repo.path, payload });

      expect(result.exitCode).toBe(0);
      expect(parseJsonRpcLines(result.stdout)).toEqual([
        expect.objectContaining({
          jsonrpc: '2.0',
          id: 1,
          result: expect.objectContaining({ protocolVersion: 1 }),
        }),
        {
          jsonrpc: '2.0',
          id: 2,
          result: { sessions: [] },
        },
      ]);
      expect(result.stdout).not.toContain('\u001b[');
    },
    { timeout: 20000 },
  );

  it(
    'continues serving valid raw stdio requests after mixed malformed input and notifications',
    async () => {
      const repo = await helper.createGitRepo();
      const payload = [
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'init',
          method: 'initialize',
          params: {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
              terminal: true,
            },
          },
        }),
        JSON.stringify({
          jsonrpc: '2.0',
          method: AGENT_METHODS.session_cancel,
          params: { sessionId: 'missing-session' },
        }),
        'not-json',
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'invalid',
          method: AGENT_METHODS.session_list,
          params: { cwd: 'relative/path' },
        }),
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'list',
          method: AGENT_METHODS.session_list,
          params: { cwd: repo.path },
        }),
      ].join('\n');

      const result = await runRawAcpRequest({ repoPath: repo.path, payload });
      const messages = parseJsonRpcLines(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(byJsonRpcId(messages, 'init')).toMatchObject({
        jsonrpc: '2.0',
        result: { protocolVersion: 1 },
      });
      expect(messages.some((message) => message?.id === undefined)).toBe(false);
      expect(
        messages.some(
          (message) =>
            message?.id === null &&
            message?.error?.code === -32700 &&
            message?.error?.message === 'Parse error',
        ),
      ).toBe(true);
      expect(byJsonRpcId(messages, 'invalid')).toMatchObject({
        jsonrpc: '2.0',
        error: { code: -32602 },
      });
      expect(byJsonRpcId(messages, 'list')).toEqual({
        jsonrpc: '2.0',
        id: 'list',
        result: { sessions: [] },
      });
      expect(result.stdout).not.toContain('\u001b[');
    },
    { timeout: 20000 },
  );
});
