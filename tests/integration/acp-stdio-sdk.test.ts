import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import { ClientSideConnection, ndJsonStream, type Client } from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'bun:test';

import { resolveBunExecutable } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

const PROJECT_ROOT = path.resolve(process.cwd());
const CLI_ENTRY = path.join(PROJECT_ROOT, 'src', 'cli', 'index.ts');
const REQUEST_TIMEOUT_MS = 5000;
const PROCESS_STOP_TIMEOUT_MS = 1500;

type AcpSdkServer = {
  clientConn: ClientSideConnection;
  updates: unknown[];
  stderrText: () => string;
  stdoutText: () => string;
  stop: () => Promise<void>;
};

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

async function createIsolatedCliEnv(): Promise<NodeJS.ProcessEnv> {
  const dotenvDir = await helper.createTempDir('salmonloop-acp-dotenv-');
  const dotenvPath = path.join(dotenvDir, '.env');
  await writeFile(dotenvPath, '', 'utf8');

  const home = await helper.createTempDir('salmonloop-acp-home-');
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';

  return {
    ...process.env,
    DOTENV_CONFIG_PATH: dotenvPath,
    FORCE_COLOR: '0',
    HOME: home,
    NO_COLOR: '1',
    SALMONLOOP_API_KEY: '',
    SALMONLOOP_USER_CONFIG_HOME: home,
    S8P_API_KEY: '',
    USERPROFILE: home,
    [pathKey]: process.env[pathKey],
  };
}

function spawnAcpCli(repoPath: string, env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  return spawn(
    resolveBunExecutable(),
    [CLI_ENTRY, '--repo', repoPath, 'serve', 'acp', '--no-color'],
    {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
}

function createTestClient(updates: unknown[]): Client {
  return {
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    sessionUpdate: async (params) => {
      updates.push(params);
    },
  };
}

async function startAcpSdkServer(repoPath: string): Promise<AcpSdkServer> {
  const env = await createIsolatedCliEnv();
  const child = spawnAcpCli(repoPath, env);
  const updates: unknown[] = [];
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
  const clientConn = new ClientSideConnection(() => createTestClient(updates), stream);

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
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const env = await createIsolatedCliEnv();
  const child = spawnAcpCli(params.repoPath, env);
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
      expect(
        initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories,
      ).toBeUndefined();

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
      const lines = result.stdout.trim().split('\n').filter(Boolean);

      expect(result.exitCode).toBe(0);
      expect(lines).toHaveLength(1);
      const response = JSON.parse(lines[0]);
      expect(response).toMatchObject({
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
});
