import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { runGitCommand } from '../../src/core/adapters/git/git-runner.js';
import { defaultPathAdapter } from '../../src/core/adapters/path/path-adapter.js';
import { spawnCommand } from '../../src/core/runtime/process-runner.js';

const fsMocks = (() => {
  const realpathSync = mock().mockImplementation((_p: string) => {
    throw new Error('ENOENT');
  });
  return {
    realpathSync,
  };
})();

mock.module('fs', () => fsMocks);

mock.module('../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: mock(),
}));

describe('runGitCommand', () => {
  beforeEach(() => {
    (spawnCommand as any).mockResolvedValue({
      code: 0,
      signal: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it('rejects when cwd escapes repoRoot', async () => {
    await expect(
      runGitCommand({
        repoRoot: defaultPathAdapter.resolve('/repo'),
        cwd: defaultPathAdapter.resolve('/tmp'),
        args: ['status'],
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/outside repoRoot/i);
  });

  it('rejects when realpath escapes repoRoot via symlink', async () => {
    fsMocks.realpathSync.mockImplementation((p: string) => {
      // normalize inputs since defaultPathAdapter.resolve might produce drive letters or backslashes
      const repoLink = defaultPathAdapter.resolve('/repo-link');
      const sub = defaultPathAdapter.resolve('/repo-link/sub');
      if (p === repoLink) return defaultPathAdapter.resolve('/real/repo');
      if (p === sub) return defaultPathAdapter.resolve('/real/outside');
      if (typeof p === 'string' && p.startsWith(repoLink)) {
        return p.replace(new RegExp(`^${repoLink}`), defaultPathAdapter.resolve('/real/repo'));
      }
      return p;
    });

    await expect(
      runGitCommand({
        repoRoot: defaultPathAdapter.resolve('/repo-link'),
        cwd: defaultPathAdapter.resolve('/repo-link/sub'),
        args: ['status'],
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/outside repoRoot/i);
  });

  it('captures stdout/stderr and returns ok=true on exit 0', async () => {
    (spawnCommand as any).mockImplementation(async (input: any) => {
      input.onStdoutChunk?.(Buffer.from('A\n'));
      input.onStderrChunk?.(Buffer.from('warning\n'));
      return {
        code: 0,
        signal: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    const promise = runGitCommand({
      repoRoot: '/repo',
      cwd: '/repo',
      args: ['status', '--porcelain'],
      timeoutMs: 1000,
    });

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(res.stdout.toString('utf8')).toBe('A\n');
    expect(res.stderr).toBe('warning\n');
  });

  it('truncates stdout when maxStdoutBytes is reached', async () => {
    (spawnCommand as any).mockImplementation(async (input: any) => {
      input.onStdoutChunk?.(Buffer.from('abcdef'));
      return {
        code: 0,
        signal: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    const promise = runGitCommand({
      repoRoot: '/repo',
      cwd: '/repo',
      args: ['diff'],
      timeoutMs: 1000,
      limits: { maxStdoutBytes: 3 },
    });

    const res = await promise;
    expect(res.stdout.toString('utf8')).toBe('abc');
    expect(res.stdoutTruncated).toBe(true);
  });

  it('marks timedOut when runtime reports timeout', async () => {
    (spawnCommand as any).mockImplementation(async (input: any) => {
      input.onStderrChunk?.(Buffer.from('timeout'));
      return {
        code: null,
        signal: 'SIGKILL',
        timedOut: true,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });

    const res = await runGitCommand({
      repoRoot: '/repo',
      cwd: '/repo',
      args: ['rev-parse', '--is-inside-work-tree'],
      timeoutMs: 10,
    });

    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
  });
});
