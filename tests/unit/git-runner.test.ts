import { runGitCommand } from '../../src/core/adapters/git/git-runner.js';
import { spawnCommand } from '../../src/core/runtime/process-runner.js';

const fsMocks = vi.hoisted(() => {
  const realpathSync = vi.fn<[string], string>().mockImplementation((_p: string) => {
    throw new Error('ENOENT');
  });
  return {
    realpathSync,
  };
});

vi.mock('fs', () => fsMocks);

vi.mock('../../src/core/runtime/process-runner.js', () => ({
  spawnCommand: vi.fn(),
}));

describe('runGitCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawnCommand).mockResolvedValue({
      code: 0,
      signal: null,
      timedOut: false,
    });
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

  it('rejects when realpath escapes repoRoot via symlink', async () => {
    fsMocks.realpathSync.mockImplementation((p: string) => {
      if (p === '/repo-link') return '/real/repo';
      if (p === '/repo-link/sub') return '/real/outside';
      throw new Error('ENOENT');
    });

    await expect(
      runGitCommand({
        repoRoot: '/repo-link',
        cwd: '/repo-link/sub',
        args: ['status'],
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/outside repoRoot/i);
  });

  it('captures stdout/stderr and returns ok=true on exit 0', async () => {
    vi.mocked(spawnCommand).mockImplementation(async (input) => {
      input.onStdoutChunk?.(Buffer.from('A\n'));
      input.onStderrChunk?.(Buffer.from('warning\n'));
      return {
        code: 0,
        signal: null,
        timedOut: false,
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
    vi.mocked(spawnCommand).mockImplementation(async (input) => {
      input.onStdoutChunk?.(Buffer.from('abcdef'));
      return {
        code: 0,
        signal: null,
        timedOut: false,
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
    vi.mocked(spawnCommand).mockImplementation(async (input) => {
      input.onStderrChunk?.(Buffer.from('timeout'));
      return {
        code: null,
        signal: 'SIGKILL',
        timedOut: true,
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
