import { tmpdir } from 'os';
import path from 'path';

import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { runGitCommand } from '../../../src/core/adapters/git/git-runner.js';

mock.module('../../../src/core/adapters/git/git-runner.js', () => ({
  runGitCommand: mock(),
}));

async function expectSecurityViolation(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error('Expected Security Violation');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toMatch(/Security Violation/i);
  }
}

describe('GitAdapter exec truncation handling', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('throws when stdout is truncated', async () => {
    (runGitCommand as any).mockResolvedValue({
      ok: true,
      code: 0,
      signal: null,
      stdout: Buffer.from('abc', 'utf8'),
      stderr: '',
      timedOut: false,
      stdoutTruncated: true,
      stderrTruncated: false,
    });

    const git = new GitAdapter('/repo');

    await expect(
      git.exec(['status'], { limits: { maxStdoutBytes: 1, maxStderrChars: 100 } }),
    ).rejects.toThrow(/truncated/i);
  });

  it('execMeta returns truncation metadata without throwing', async () => {
    (runGitCommand as any).mockResolvedValue({
      ok: true,
      code: 0,
      signal: null,
      stdout: Buffer.from('abc', 'utf8'),
      stderr: '',
      timedOut: false,
      stdoutTruncated: true,
      stderrTruncated: false,
    });

    const git = new GitAdapter('/repo');
    const res = await git.execMeta(['status'], {
      limits: { maxStdoutBytes: 1, maxStderrChars: 1 },
    });

    expect(res.ok).toBe(true);
    expect(res.stdoutTruncated).toBe(true);
  });
});

describe('GitAdapter query gateway validation', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('allows approved commands', async () => {
    (runGitCommand as any).mockResolvedValue({
      ok: true,
      code: 0,
      signal: null,
      stdout: Buffer.from('', 'utf8'),
      stderr: '',
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const git = new GitAdapter('/repo');
    await expect(git.query(['status', '--porcelain'])).resolves.toBe('');
    expect(runGitCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects unapproved commands', async () => {
    const git = new GitAdapter('/repo');
    await expect(git.query(['reset', '--hard'])).rejects.toThrow(/Security Violation/i);
    expect(runGitCommand).not.toHaveBeenCalled();
  });

  it('rejects diff --no-index', async () => {
    const git = new GitAdapter('/repo');
    await expect(git.query(['diff', '--no-index', '/etc/passwd', '/etc/hosts'])).rejects.toThrow(
      /Security Violation/i,
    );
    expect(runGitCommand).not.toHaveBeenCalled();
  });

  it('rejects update-ref outside refs/s8p', async () => {
    const git = new GitAdapter('/repo');
    await expect(
      git.query(['update-ref', '-m', 'msg', 'refs/heads/main', '0123456789abcdef0']),
    ).rejects.toThrow(/Security Violation/i);
    expect(runGitCommand).not.toHaveBeenCalled();
  });

  it('allows worktree operations only under temp shadow root', async () => {
    (runGitCommand as any).mockResolvedValue({
      ok: true,
      code: 0,
      signal: null,
      stdout: Buffer.from('', 'utf8'),
      stderr: '',
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const shadowRoot = path.join(path.resolve(tmpdir()), 's8p-wt');
    const worktreePath = path.join(shadowRoot, 'repo', 'test');

    const git = new GitAdapter('/repo');
    const output = await git.query([
      'worktree',
      'add',
      '--quiet',
      '--detach',
      worktreePath,
      'HEAD',
    ]);
    expect(output).toBe('');
    expect(runGitCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects worktree operations under temp-prefix lookalike paths', async () => {
    const fakeShadowRoot = `${path.join(path.resolve(tmpdir()), 's8p-wt')}-evil`;
    const fakeWorktreePath = path.join(fakeShadowRoot, 'repo', 'test');

    const git = new GitAdapter('/repo');
    await expectSecurityViolation(
      git.query(['worktree', 'add', '--quiet', '--detach', fakeWorktreePath, 'HEAD']),
    );
    await expectSecurityViolation(git.query(['worktree', 'remove', '--force', fakeWorktreePath]));
    expect(runGitCommand).not.toHaveBeenCalled();
  });

  it('refuses destructive rollback recovery outside shadow worktree', async () => {
    (runGitCommand as any).mockResolvedValueOnce({
      ok: false,
      code: 1,
      signal: null,
      stdout: Buffer.from('', 'utf8'),
      stderr: 'checkout failed',
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const git = new GitAdapter('/repo');
    const error = await git.rollbackFiles(['a.txt']).then(
      () => null,
      (e) => e as Error,
    );
    if (!error) {
      throw new Error('Expected rollbackFiles to fail');
    }
    expect(error.message).toMatch(/Conflict resolution denied|checkout failed/i);
    expect(error.message).toMatch(/original rollback error:[\s\S]*checkout failed/i);
    expect(runGitCommand).toHaveBeenCalledTimes(1);
  });
});

describe('GitAdapter shadow path parity handling', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('allows updateIndex inside parity worktree root', async () => {
    (runGitCommand as any).mockResolvedValue({
      ok: true,
      code: 0,
      signal: null,
      stdout: Buffer.from('', 'utf8'),
      stderr: '',
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const baseRepo = path.join(path.resolve('/tmp'), 'repo');
    const parityRoot = path.join(path.dirname(baseRepo), '.salmonloop', 'worktrees');
    const worktreePath = path.join(parityRoot, path.basename(baseRepo), '123');

    const git = new GitAdapter(worktreePath);

    await expect(git.updateIndex('100644', 'deadbeef', 'file.txt')).resolves.toBeUndefined();
    expect(runGitCommand).toHaveBeenCalledTimes(1);
  });
});
