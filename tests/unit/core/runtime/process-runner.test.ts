import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  spawnCommand,
  spawnInteractiveProcess,
} from '../../../../src/core/runtime/process-runner.js';

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events');
  return {
    spawn: vi.fn().mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = vi.fn();
      child.stdin.write = vi.fn();
      child.kill = vi.fn();
      child.pid = 777;
      return child;
    }),
  };
});

function makeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = vi.fn();
  child.stdin.write = vi.fn();
  child.kill = vi.fn();
  child.pid = 778;
  return child;
}

describe('process-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).Bun;
  });

  afterEach(() => {
    delete (globalThis as any).Bun;
    vi.useRealTimers();
  });

  it('captures output with truncation and callbacks', async () => {
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child);
    const stdoutSpy = vi.fn();
    const stderrSpy = vi.fn();

    const promise = spawnCommand({
      command: 'git',
      args: ['status'],
      timeoutMs: 500,
      maxStdoutBytes: 3,
      maxStderrBytes: 4,
      onStdoutChunk: stdoutSpy,
      onStderrChunk: stderrSpy,
    });

    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('abcdef'));
      child.stderr.emit('data', Buffer.from('123456'));
      child.emit('close', 0, null);
    });

    const result = await promise;
    expect(result.code).toBe(0);
    expect(result.failure).toBeUndefined();
    expect(result.stdout).toBe('abc');
    expect(result.stderr).toBe('1234');
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(stdoutSpy).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('returns timeout failure when process exceeds timeout', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    child.kill = vi.fn((signal?: string) => {
      if (signal === 'SIGKILL') {
        queueMicrotask(() => child.emit('close', null, signal));
      }
      return true;
    });
    vi.mocked(spawn).mockReturnValue(child);

    const promise = spawnCommand({
      command: 'git',
      args: ['status'],
      timeoutMs: 10,
      killGraceMs: 5,
    });

    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.failure?.kind).toBe('timeout');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('spawns interactive process via node fallback', async () => {
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const proc = spawnInteractiveProcess({
      command: 'node',
      args: ['server.js'],
    });
    const onExit = vi.fn();
    proc.on('exit', onExit);

    child.emit('exit', 0, null);

    expect(proc.stdout).toBeDefined();
    expect(proc.stderr).toBeDefined();
    expect(onExit).toHaveBeenCalledWith(0, null);
  });

  it('prefers Bun interactive runtime when available', async () => {
    const bunSpawn = vi.fn().mockImplementation(() => ({
      pid: 999,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('out'));
          controller.close();
        },
      }),
      stderr: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      kill: vi.fn(),
      signalCode: null,
      exited: Promise.resolve(0),
    }));

    (globalThis as any).Bun = {
      spawn: bunSpawn,
    };

    const proc = spawnInteractiveProcess({
      command: 'node',
      args: ['server.js'],
    });

    const onExit = vi.fn();
    proc.on('exit', onExit);
    await Promise.resolve();

    expect(bunSpawn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(typeof (proc.stdout as any)?.on).toBe('function');
    expect(onExit).toHaveBeenCalledWith(0, null);
  });
});
