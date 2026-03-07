import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { RealFsTestHelper } from '../../helpers/real-fs-helper.js';

describe('CheckpointManager behavior safety', () => {
  const helper = new RealFsTestHelper();
  const manager = new CheckpointManager();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('creates snapshot without mutating current index/worktree state', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/file.ts', content: 'base\n' }],
    });

    await helper.modifyFile(repo.path, 'src/file.ts', 'staged\n', true);
    await helper.modifyFile(repo.path, 'src/file.ts', 'unstaged\n');

    const statusBefore = await helper.getGitStatus(repo.path);
    const indexBefore = await helper.git(repo.path, ['show', ':src/file.ts']);

    const snapshot = await manager.createSafeSnapshot(repo.path);

    const statusAfter = await helper.getGitStatus(repo.path);
    const indexAfter = await helper.git(repo.path, ['show', ':src/file.ts']);
    const workingAfter = await helper.readFile(repo.path, 'src/file.ts');

    expect(snapshot.commitHash.length).toBeGreaterThan(0);
    expect(statusAfter).toBe(statusBefore);
    expect(indexAfter.stdout).toBe(indexBefore.stdout);
    expect(workingAfter).toBe('unstaged\n');
  });

  it('captures staged and unstaged views in snapshot artifacts', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/file.ts', content: 'base\n' }],
    });

    await helper.modifyFile(repo.path, 'src/file.ts', 'staged\n', true);
    await helper.modifyFile(repo.path, 'src/file.ts', 'unstaged\n');

    const snapshot = await manager.createSafeSnapshot(repo.path);
    const details = await manager.getSnapshotDetails(repo.path, snapshot.commitHash);
    const snapshotContent = await manager.readSnapshotFile(
      repo.path,
      snapshot.commitHash,
      'src/file.ts',
    );

    expect(details.stagedFiles).toContain('src/file.ts');
    expect(details.unstagedFiles).toContain('src/file.ts');
    expect(snapshotContent).toBe('unstaged');
  });

  it('restores snapshot state with index and working tree separation preserved', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/file.ts', content: 'base\n' }],
    });

    await helper.modifyFile(repo.path, 'src/file.ts', 'staged\n', true);
    await helper.modifyFile(repo.path, 'src/file.ts', 'unstaged\n');
    const snapshot = await manager.createSafeSnapshot(repo.path);

    await helper.modifyFile(repo.path, 'src/file.ts', 'garbage\n', true);
    await helper.modifyFile(repo.path, 'src/file.ts', 'garbage-unstaged\n');

    await manager.restoreToMain(repo.path, snapshot.commitHash, true);

    const working = await helper.readFile(repo.path, 'src/file.ts');
    const index = await helper.git(repo.path, ['show', ':src/file.ts']);
    const status = await helper.getGitStatus(repo.path);

    // Cross-platform: normalize line endings for comparison
    const workingStr = typeof working === 'string' ? working : working.toString('utf-8');
    const normalizedWorking = workingStr.replace(/\r\n/g, '\n');
    const normalizedIndex = index.stdout.replace(/\r\n/g, '\n');

    expect(normalizedWorking).toBe('unstaged\n');
    expect(normalizedIndex).toBe('staged');
    expect(status).toContain('MM src/file.ts');
  });

  it('rejects non-snapshot commits with invalid metadata', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/file.ts', content: 'base\n' }],
    });

    await expect(manager.restoreToMain(repo.path, 'HEAD', true)).rejects.toThrow(
      'Invalid snapshot metadata',
    );
    await expect(manager.restoreDirtyBackup(repo.path, 'HEAD')).rejects.toThrow(
      'Invalid backup metadata',
    );
  });
});
