import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock the dependency before importing GitAdapter
mock.module('../../../../../src/core/adapters/git/git-runner.js', () => {
  return {
    runGitCommand: mock(() => {
      return Promise.resolve({
        ok: true,
        code: 0,
        signal: null,
        stdout: Buffer.from('mocked output\n'),
        stderr: '',
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    }),
  };
});

import { GitAdapter } from '../../../../../src/core/adapters/git/git-adapter.js';
import * as gitRunner from '../../../../../src/core/adapters/git/git-runner.js';
import { GitError } from '../../../../../src/core/types/index.js';

describe('GitAdapter', () => {
  let adapter: GitAdapter;
  const mockRepoPath = '/mock/repo/path';

  beforeEach(() => {
    adapter = new GitAdapter(mockRepoPath);
    (gitRunner.runGitCommand as ReturnType<typeof mock>).mockClear();
  });

  describe('Initialization', () => {
    it('initializes with a repository path', () => {
      expect(adapter.repoPath).toBe(mockRepoPath);
    });
  });

  describe('Base Execution Layer', () => {
    describe('execMeta', () => {
      it('calls runGitCommand with correct arguments', async () => {
        await adapter.execMeta(['status', '--porcelain'], { cwd: '/mock/cwd', timeoutMs: 1000 });

        expect(gitRunner.runGitCommand).toHaveBeenCalledTimes(1);
        expect(gitRunner.runGitCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            repoRoot: mockRepoPath,
            args: ['status', '--porcelain'],
            cwd: '/mock/cwd',
            timeoutMs: 1000,
          }),
        );
      });
    });

    describe('exec', () => {
      it('returns trimmed output on success', async () => {
        const result = await adapter.exec(['status']);
        expect(result).toBe('mocked output'); // original mock is 'mocked output\n'
      });

      it('returns untrimmed output when trim is false', async () => {
        const result = await adapter.exec(['status'], { trim: false });
        expect(result).toBe('mocked output\n');
      });

      it('throws GitError on failure when allowError is false', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: false,
          code: 1,
          signal: null,
          stdout: Buffer.from(''),
          stderr: 'error message',
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        });

        const promise = adapter.exec(['status']);
        await expect(promise).rejects.toThrow(GitError);
      });

      it('does not throw GitError on failure when allowError is true', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: false,
          code: 1,
          signal: null,
          stdout: Buffer.from('some stdout'),
          stderr: 'error message',
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        });

        const result = await adapter.exec(['status'], { allowError: true });
        expect(result).toBe('some stdout');
      });

      it('throws GitError on timeout', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: false,
          code: null,
          signal: null,
          stdout: Buffer.from(''),
          stderr: '',
          timedOut: true,
          stdoutTruncated: false,
          stderrTruncated: false,
        });

        const promise = adapter.exec(['status']);
        await expect(promise).rejects.toThrow(GitError);
      });

      it('throws GitError on truncated stdout when allowTruncatedStdout is false (default)', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: true,
          code: 0,
          signal: null,
          stdout: Buffer.from('truncated'),
          stderr: '',
          timedOut: false,
          stdoutTruncated: true,
          stderrTruncated: false,
        });

        const promise = adapter.exec(['status']);
        await expect(promise).rejects.toThrow(GitError);
      });
    });
  });

  describe('Query Layer', () => {
    describe('query', () => {
      it('allows permitted commands', async () => {
        const allowedCommands = [
          'diff',
          'for-each-ref',
          'log',
          'ls-files',
          'ls-tree',
          'read-tree',
          'rev-parse',
          'show',
          'status',
          'update-index',
          'update-ref',
          'worktree',
          'write-tree',
        ];

        for (const cmd of allowedCommands) {
          (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
            ok: true,
            code: 0,
            signal: null,
            stdout: Buffer.from(`output for ${cmd}`),
            stderr: '',
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          });

          let args = [cmd];

          // Need to supply extra args for these specific commands to bypass assertQueryAllowed rules
          if (cmd === 'read-tree') args = [cmd, '1234567890123456789012345678901234567890'];
          else if (cmd === 'update-index') args = [cmd, '-q', '--refresh'];
          else if (cmd === 'update-ref')
            args = [cmd, '-m', 'msg', 'refs/s8p/test', '1234567890123456789012345678901234567890'];
          else if (cmd === 'write-tree') args = [cmd];
          else if (cmd === 'for-each-ref')
            args = [cmd, '--format=%(refname)', 'refs/s8p/snapshots/'];
          else if (cmd === 'worktree') args = [cmd, 'list', '--porcelain'];

          const result = await adapter.query(args);
          expect(result).toBe(`output for ${cmd}`);
        }
      });

      it('throws Error for disallowed commands', async () => {
        const disallowedCommands = ['commit', 'push', 'checkout', 'reset', 'clean', 'rm', 'add'];

        for (const cmd of disallowedCommands) {
          const promise = adapter.query([cmd]);
          await expect(promise).rejects.toThrow(/Security violation/i);
        }
      });

      it('throws Error for malformed allowed commands', async () => {
        const promise = adapter.query(['update-index', 'invalid']);
        await expect(promise).rejects.toThrow(/Security violation/i);
      });
    });
  });

  describe('Business Layer', () => {
    describe('hashObject', () => {
      it('executes hash-object --stdin with buffer input', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: true,
          code: 0,
          signal: null,
          stdout: Buffer.from('1234567890abcdef1234567890abcdef12345678\n'),
          stderr: '',
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        });

        const content = Buffer.from('test content');
        const hash = await adapter.hashObject(content);

        expect(hash).toBe('1234567890abcdef1234567890abcdef12345678');
        expect(gitRunner.runGitCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            args: ['hash-object', '--stdin'],
            input: content,
          }),
        );
      });
    });

    describe('checkIgnore', () => {
      it('returns true when file is ignored', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: true,
          code: 0,
          signal: null,
          stdout: Buffer.from('ignored.txt\n'),
          stderr: '',
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        });

        const isIgnored = await adapter.checkIgnore('ignored.txt');
        expect(isIgnored).toBe(true);
        expect(gitRunner.runGitCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            args: ['check-ignore', '-q', '--no-index', 'ignored.txt'],
          }),
        );
      });

      it('returns false when file is not ignored (exit code 1)', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: false,
          code: 1, // git check-ignore returns 1 if not ignored
          signal: null,
          stdout: Buffer.from(''),
          stderr: '',
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        });

        const isIgnored = await adapter.checkIgnore('not-ignored.txt');
        expect(isIgnored).toBe(false);
      });

      it('returns false on generic failure (exit code 128)', async () => {
        (gitRunner.runGitCommand as ReturnType<typeof mock>).mockResolvedValueOnce({
          ok: false,
          code: 128,
          signal: null,
          stdout: Buffer.from(''),
          stderr: 'fatal: error',
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        });

        // checkIgnore uses allowError: true and just checks if code === 0, so it doesn't throw on error it just returns false.
        const isIgnored = await adapter.checkIgnore('error.txt');
        expect(isIgnored).toBe(false);
      });
    });
  });
});
