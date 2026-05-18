import { mock, describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { ErrorType } from '../../src/core/types/index.js';
import { runVerify, classifyError, preflight } from '../../src/core/verification/runner.js';
import { buildBunCommand } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Verify Integration Tests with Real FS', () => {
  const helper = new RealFsTestHelper();
  const bunCommand = (args: string) => buildBunCommand(args);
  let repoPath: string;

  beforeEach(async () => {
    const repo = await helper.createGitRepo();
    repoPath = repo.path;
    mock.clearAllMocks();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should run verify command successfully with real process', async () => {
    // Run a real bun process with a successful exit code.
    // Use process.exit(0) with simpler escaping for Windows compatibility
    const result = await runVerify(repoPath, bunCommand('-e "process.exit(0)"'));
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
  });

  it('should fail when verify command returns non-zero exit code', async () => {
    // Run a command that doesn't exist, which will fail on all platforms
    const result = await runVerify(repoPath, bunCommand('nonexistent-command-that-does-not-exist'));
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('should classify errors correctly', () => {
    expect(classifyError('TS2322: Type string is not assignable to type number')).toBe(
      ErrorType.COMPILATION,
    );
    expect(classifyError('failed to compile')).toBe(ErrorType.COMPILATION);
    expect(classifyError('ESLint found 5 errors')).toBe(ErrorType.LINT);
    expect(classifyError('Test suites: 1 failed, 1 total')).toBe(ErrorType.TEST);
    expect(classifyError('AssertionError: expected 1 to be 2')).toBe(ErrorType.TEST);
    expect(classifyError('Some random error')).toBe(ErrorType.LOGIC);
  });

  it('should perform preflight checks on real git repo', async () => {
    const result = await preflight({
      baseRepoPath: repoPath,
      workPath: repoPath,
      strategy: 'direct',
    });

    expect(result.ok).toBe(true);
  });

  it('should allow dirty preflight when ignoreDirty is enabled', async () => {
    // Make repo dirty by adding an uncommitted file.
    await helper.writeFile(repoPath, 'dirty.txt', 'dirty');

    const result = await preflight(
      {
        baseRepoPath: repoPath,
        workPath: repoPath,
        strategy: 'direct',
      },
      undefined,
      { ignoreDirty: true },
    );

    expect(result.ok).toBe(true);
  });

  it('should fail preflight if not a git repo', async () => {
    // Create a non-git directory.
    const nonGitDir = await helper.createTempDir('not-a-repo-');

    const result = await preflight({
      baseRepoPath: nonGitDir,
      workPath: nonGitDir,
      strategy: 'direct',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not a git repository|untracked/i);
  });

  it('should allow non-git preflight when the selected flow does not require git', async () => {
    const nonGitDir = await helper.createTempDir('not-a-repo-autopilot-');

    const result = await preflight(
      {
        baseRepoPath: nonGitDir,
        workPath: nonGitDir,
        strategy: 'direct',
      },
      undefined,
      { requireGit: false },
    );

    expect(result.ok).toBe(true);
  });

  it('should treat a bare git repository as not being a work tree', async () => {
    const bareRepoPath = await helper.createTempDir('bare-repo-');
    const init = await helper.git(bareRepoPath, ['init', '--bare']);
    expect(init.exitCode).toBe(0);

    const result = await preflight(
      {
        baseRepoPath: bareRepoPath,
        workPath: bareRepoPath,
        strategy: 'direct',
      },
      undefined,
      { requireGit: false },
    );

    expect(result.ok).toBe(true);
    expect(result.capabilities?.git.insideWorkTree).toBe(false);
    expect(result.capabilities?.git.reason).toContain('--is-inside-work-tree=false');
  });

  it('should allow read-only preflight when writes are not required', async () => {
    const result = await preflight(
      {
        baseRepoPath: repoPath,
        workPath: repoPath,
        strategy: 'direct',
        capabilities: {
          git: { available: true, insideWorkTree: true },
          filesystem: { readable: true, writable: false, reason: 'read-only workspace' },
        },
      },
      undefined,
      { requireWrite: false, ignoreDirty: true },
    );

    expect(result.ok).toBe(true);
    expect(result.capabilities?.filesystem.writable).toBe(false);
  });

  it('should fail writable preflight when the selected flow needs workspace writes', async () => {
    const result = await preflight(
      {
        baseRepoPath: repoPath,
        workPath: repoPath,
        strategy: 'direct',
        capabilities: {
          git: { available: true, insideWorkTree: true },
          filesystem: { readable: true, writable: false, reason: 'read-only workspace' },
        },
      },
      undefined,
      { requireWrite: true },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('read-only workspace');
  });

  it('should report capabilities for the active execution workspace', async () => {
    const worktreePath = await helper.createWorktree(repoPath);
    await helper.writeFile(worktreePath, 'worktree-only.txt', 'worktree change');

    const result = await preflight({
      baseRepoPath: repoPath,
      workPath: worktreePath,
      strategy: 'worktree',
    });

    expect(result.ok).toBe(true);
    expect(result.capabilities?.git.insideWorkTree).toBe(true);

    const worktreeHead = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(result.capabilities?.git.head).toBe(worktreeHead);
  });
});
