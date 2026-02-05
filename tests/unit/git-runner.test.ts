import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { runGitCommand } from '../../src/core/adapters/git/git-runner.js';

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
  return child;
}

describe('runGitCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when cwd escapes repoRoot', async () => {
    await expect(
      runGitCommand({
        repoRoot: '/repo',
        cwd: '/tmp',
        args: ['status'],
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/outside repoRoot/i);
  });

  it('captures stdout/stderr and returns ok=true on exit 0', async () => {
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const promise = runGitCommand({
      repoRoot: '/repo',
      cwd: '/repo',
      args: ['status', '--porcelain'],
      timeoutMs: 1000,
    });

    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('A\n'));
      child.stderr.emit('data', Buffer.from('warning\n'));
      child.emit('close', 0, null);
    });

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(res.stdout.toString('utf8')).toBe('A\n');
    expect(res.stderr).toBe('warning\n');
  });

  it('truncates stdout when maxStdoutBytes is reached', async () => {
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child);

    const promise = runGitCommand({
      repoRoot: '/repo',
      cwd: '/repo',
      args: ['diff'],
      timeoutMs: 1000,
      limits: { maxStdoutBytes: 3 },
    });

    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('abcdef'));
      child.emit('close', 0, null);
    });

    const res = await promise;
    expect(res.stdout.toString('utf8')).toBe('abc');
    expect(res.stdoutTruncated).toBe(true);
  });

  it('marks timedOut and attempts to kill the process', async () => {
    vi.useFakeTimers();

    const child = makeChild();
    child.kill = vi.fn((signal?: string) => {
      if (signal === 'SIGKILL') {
        queueMicrotask(() => child.emit('close', null, signal ?? null));
      }
      return true;
    });
    vi.mocked(spawn).mockReturnValue(child);

    const promise = runGitCommand({
      repoRoot: '/repo',
      cwd: '/repo',
      args: ['rev-parse', '--is-inside-work-tree'],
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(9000);
    const res = await promise;

    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    vi.useRealTimers();
  });
});
