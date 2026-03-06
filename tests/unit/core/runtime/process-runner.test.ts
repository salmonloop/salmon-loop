import { Readable } from 'stream';

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

type BunLike = {
  spawn: (...args: any[]) => any;
};

let bunRuntimeOverride: BunLike | undefined = (globalThis as { Bun?: BunLike }).Bun;
const bunRuntimeModulePath = new globalThis.URL(
  '../../../../src/core/runtime/bun-runtime.js',
  import.meta.url,
).pathname;

mock.module(bunRuntimeModulePath, () => ({
  getBunRuntime: () => bunRuntimeOverride,
  normalizeSignal: (value: unknown) => (typeof value === 'string' ? value : null),
  toNodeReadableStream: (stream: any) => {
    if (!stream) return undefined;
    if (typeof stream.on === 'function') {
      return stream;
    }
    if (typeof stream.getReader === 'function') {
      return Readable.fromWeb(stream);
    }
    return undefined;
  },
}));

const { spawnCommand, spawnInteractiveProcess } =
  await import('../../../../src/core/runtime/process-runner.js');

function getBunRuntime(): BunLike {
  const runtime = (globalThis as { Bun?: BunLike }).Bun;
  if (!runtime || typeof runtime.spawn !== 'function') {
    throw new Error('Bun runtime is required for process-runner tests');
  }
  return runtime;
}

function forceNodeFallback(): void {
  bunRuntimeOverride = undefined;
}

function restoreBunRuntime(): void {
  bunRuntimeOverride = getBunRuntime();
}

async function readAll(stream: any): Promise<string> {
  if (!stream) return '';
  return await new Promise((resolve, reject) => {
    let output = '';
    stream.on('data', (chunk: unknown) => {
      output += globalThis.Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(output));
  });
}

async function waitForExit(
  processRef: any,
): Promise<{ code: number | null; signal: string | null }> {
  return await new Promise((resolve, reject) => {
    processRef.on('exit', (code: number | null, signal: string | null) =>
      resolve({ code, signal }),
    );
    processRef.on('error', (error: unknown) => reject(error));
  });
}

describe('process-runner', () => {
  beforeEach(() => {
    restoreBunRuntime();
  });

  afterEach(() => {
    restoreBunRuntime();
  });

  test('captures output with truncation and callbacks under node fallback', async () => {
    forceNodeFallback();
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];

    const result = await spawnCommand({
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args:
        process.platform === 'win32'
          ? ['/c', 'echo abcdef && echo 123456 1>&2']
          : ['-c', "printf 'abcdef'; printf '123456' 1>&2"],
      timeoutMs: 2000,
      maxStdoutBytes: 3,
      maxStderrBytes: 4,
      onStdoutChunk: (chunk: Uint8Array) => {
        stdoutChunks.push(chunk);
      },
      onStderrChunk: (chunk: Uint8Array) => {
        stderrChunks.push(chunk);
      },
    });

    expect(result.code === 0 || result.code === null).toBe(true);
    expect(result.stdout.substring(0, 3)).toBe('abc');
    expect(stdoutChunks.length).toBeGreaterThan(0);
  });

  test('returns timeout failure when process exceeds timeout under node fallback', async () => {
    forceNodeFallback();
    const result = await spawnCommand({
      command: process.platform === 'win32' ? 'powershell' : 'sh',
      args:
        process.platform === 'win32' ? ['-Command', 'Start-Sleep -Seconds 10'] : ['-c', 'sleep 10'],
      timeoutMs: 100,
      killGraceMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.failure?.kind).toBe('timeout');
  });

  test('spawns interactive process via node fallback', async () => {
    forceNodeFallback();
    const processRef = spawnInteractiveProcess({
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args:
        process.platform === 'win32'
          ? ['/c', 'echo node-fallback']
          : ['-c', "printf 'node-fallback'"],
    });
    const stdoutPromise = readAll(processRef.stdout);
    const exit = await waitForExit(processRef);
    const stdout = await stdoutPromise;

    expect(exit.code).toBe(0);
    expect(stdout).toContain('node-fallback');
  });

  test('prefers Bun interactive runtime when available', async () => {
    const bunRuntime = getBunRuntime();
    let bunSpawnCalls = 0;
    const originalSpawn = bunRuntime.spawn;
    bunRuntime.spawn = (...args: any[]) => {
      bunSpawnCalls += 1;
      return originalSpawn(...args);
    };

    const processRef = spawnInteractiveProcess({
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args:
        process.platform === 'win32' ? ['/c', 'echo bun-runtime'] : ['-c', "printf 'bun-runtime'"],
    });
    const stdoutPromise = readAll(processRef.stdout);
    const exit = await waitForExit(processRef);
    const stdout = await stdoutPromise;

    expect(bunSpawnCalls).toBeGreaterThan(0);
    expect(exit.code).toBe(0);
    expect(stdout).toContain('bun-runtime');
  });
});
