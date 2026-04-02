import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../src/core/strata/runtime/synchronizer.js';
import type { CheckpointRef } from '../../src/core/types/index.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Dirty workspace zero-index safety matrix', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('preserves staged index and writes AI changes as unstaged in staged scenario', async () => {
    const mainRepo = await helper.createGitRepo({
      initialFiles: [
        { path: 'guard.txt', content: 'guard base\n' },
        { path: 'target.txt', content: 'target base\n' },
      ],
    });
    const worktreePath = await helper.createWorktree(mainRepo.path);

    await helper.modifyFile(mainRepo.path, 'guard.txt', 'guard staged\n', true);
    const indexBefore = await helper.git(mainRepo.path, ['rev-parse', ':guard.txt']);

    const shadowInitialRef = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
    await helper.modifyFile(worktreePath, 'target.txt', 'target from ai\n');
    await helper.git(worktreePath, ['add', 'target.txt']);
    await helper.git(worktreePath, ['commit', '-m', 'ai staged-matrix change']);
    const shadowLatestRef = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath: mainRepo.path,
      worktreePath,
      baseRef: shadowInitialRef,
      branchName: 'matrix-staged',
    };

    await new WorkspaceSynchronizer(new CheckpointManager()).applyBackToMainWorkspace(
      mainRepo.path,
      checkpointRef,
      '',
      '3way',
      'extended',
      ['target.txt'],
      shadowInitialRef,
      shadowLatestRef,
    );

    const indexAfter = await helper.git(mainRepo.path, ['rev-parse', ':guard.txt']);
    expect(indexAfter.stdout).toBe(indexBefore.stdout);
    expect(await helper.readFile(mainRepo.path, 'target.txt')).toBe('target from ai\n');
  }, 30000);

  it('preserves unstaged user edits while applying AI changes to other files', async () => {
    const mainRepo = await helper.createGitRepo({
      initialFiles: [
        { path: 'guard.txt', content: 'guard base\n' },
        { path: 'target.txt', content: 'target base\n' },
      ],
    });
    const worktreePath = await helper.createWorktree(mainRepo.path);

    await helper.modifyFile(mainRepo.path, 'guard.txt', 'guard unstaged\n');
    const guardBefore = await helper.readFile(mainRepo.path, 'guard.txt');
    const indexBefore = await helper.git(mainRepo.path, ['rev-parse', ':guard.txt']);

    const shadowInitialRef = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();
    await helper.modifyFile(worktreePath, 'target.txt', 'target from ai\n');
    await helper.git(worktreePath, ['add', 'target.txt']);
    await helper.git(worktreePath, ['commit', '-m', 'ai unstaged-matrix change']);
    const shadowLatestRef = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath: mainRepo.path,
      worktreePath,
      baseRef: shadowInitialRef,
      branchName: 'matrix-unstaged',
    };

    await new WorkspaceSynchronizer(new CheckpointManager()).applyBackToMainWorkspace(
      mainRepo.path,
      checkpointRef,
      '',
      '3way',
      'extended',
      ['target.txt'],
      shadowInitialRef,
      shadowLatestRef,
    );

    const indexAfter = await helper.git(mainRepo.path, ['rev-parse', ':guard.txt']);
    expect(indexAfter.stdout).toBe(indexBefore.stdout);
    expect(await helper.readFile(mainRepo.path, 'guard.txt')).toBe(guardBefore);
    expect(await helper.readFile(mainRepo.path, 'target.txt')).toBe('target from ai\n');
  }, 30000);

  it('preserves staged index in MM scenario after applyBack merge', async () => {
    const mainRepo = await helper.createGitRepo({
      initialFiles: [{ path: 'target.js', content: 'Header\nPadding1\nBody\nPadding2\nFooter' }],
    });
    const worktreePath = await helper.createWorktree(mainRepo.path);

    await helper.modifyFile(
      mainRepo.path,
      'target.js',
      'HeaderModifiedStaged\nPadding1\nBody\nPadding2\nFooter',
    );
    await helper.git(mainRepo.path, ['add', 'target.js']);
    await helper.modifyFile(
      mainRepo.path,
      'target.js',
      'HeaderModifiedStaged\nPadding1\nBody\nPadding2\nFooterModifiedUnstaged',
    );

    const indexBefore = await helper.git(mainRepo.path, ['rev-parse', ':target.js']);

    await helper.modifyFile(
      worktreePath,
      'target.js',
      'Header\nPadding1\nBodyAI\nPadding2\nFooter',
    );
    const diff = await helper.getGitDiff(worktreePath);

    await helper.git(worktreePath, ['add', 'target.js']);
    await helper.git(worktreePath, ['commit', '-m', 'ai mm body change']);

    const shadowInitialRef = (await helper.git(mainRepo.path, ['rev-parse', 'HEAD'])).stdout.trim();
    const shadowLatestRef = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath: mainRepo.path,
      worktreePath,
      baseRef: shadowInitialRef,
      branchName: 'matrix-mm',
    };

    await new WorkspaceSynchronizer(new CheckpointManager()).applyBackToMainWorkspace(
      mainRepo.path,
      checkpointRef,
      diff,
      '3way',
      'extended',
      ['target.js'],
      shadowInitialRef,
      shadowLatestRef,
    );

    const indexAfter = await helper.git(mainRepo.path, ['rev-parse', ':target.js']);
    expect(indexAfter.stdout).toBe(indexBefore.stdout);

    const content = await helper.readFile(mainRepo.path, 'target.js');
    expect(content).toContain('HeaderModifiedStaged');
    expect(content).toContain('BodyAI');
    expect(content).toContain('FooterModifiedUnstaged');
  }, 30000);
});
