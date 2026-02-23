import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../src/core/strata/runtime/synchronizer.js';
import type { CheckpointRef } from '../../src/core/types/index.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Concurrency Workspace Conflict Integration', () => {
  const helper = new RealFsTestHelper();
  const checkpoints = new CheckpointManager();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('surfaces content conflict when two workspaces modify the same line from the same base', async () => {
    const mainRepo = await helper.createGitRepo({
      initialFiles: [{ path: 'app.js', content: 'const value = 0;\n' }],
    });
    const worktreeA = await helper.createWorktree(mainRepo.path, undefined, 'worktree-a');
    const worktreeB = await helper.createWorktree(mainRepo.path, undefined, 'worktree-b');

    const snapshot = await checkpoints.createSafeSnapshot(mainRepo.path);
    const baseRef = snapshot.commitHash;

    await helper.git(worktreeA, ['reset', '--hard', baseRef]);
    await helper.writeFile(worktreeA, 'app.js', 'const value = 1;\n');
    await helper.git(worktreeA, ['commit', '-am', 'workspace A change']);
    const latestA = (await helper.git(worktreeA, ['rev-parse', 'HEAD'])).stdout.trim();
    const diffA = (await helper.git(worktreeA, ['diff', baseRef, 'HEAD'])).stdout;

    await helper.git(worktreeB, ['reset', '--hard', baseRef]);
    await helper.writeFile(worktreeB, 'app.js', 'const value = 2;\n');
    await helper.git(worktreeB, ['commit', '-am', 'workspace B change']);
    const latestB = (await helper.git(worktreeB, ['rev-parse', 'HEAD'])).stdout.trim();
    const diffB = (await helper.git(worktreeB, ['diff', baseRef, 'HEAD'])).stdout;

    const synchronizer = new WorkspaceSynchronizer(checkpoints);

    const checkpointA: CheckpointRef = {
      strategy: 'worktree',
      repoPath: mainRepo.path,
      worktreePath: worktreeA,
      baseRef,
      branchName: 'worktree-a',
    };

    await synchronizer.applyBackToMainWorkspace(
      mainRepo.path,
      checkpointA,
      diffA,
      '3way',
      'extended',
      ['app.js'],
      baseRef,
      latestA,
    );

    const checkpointB: CheckpointRef = {
      strategy: 'worktree',
      repoPath: mainRepo.path,
      worktreePath: worktreeB,
      baseRef,
      branchName: 'worktree-b',
    };

    await synchronizer.applyBackToMainWorkspace(
      mainRepo.path,
      checkpointB,
      diffB,
      '3way',
      'extended',
      ['app.js'],
      baseRef,
      latestB,
    );

    const finalContent = (await helper.readFile(mainRepo.path, 'app.js')) as string;
    expect(finalContent).toContain('<<<<<<<');
    expect(finalContent).toContain('const value = 1;');
    expect(finalContent).toContain('const value = 2;');
  });
});
