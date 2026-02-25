import { randomBytes } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';

describe('CheckpointManager - Filesystem Sync Fix', () => {
  type GitQueryCall = [Parameters<GitAdapter['query']>[0], ...unknown[]];

  let tempDir: string;
  let testRepo: string;
  let shadowWorktree: string;
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `salmon-test-${randomBytes(4).toString('hex')}`);
    await mkdir(tempDir, { recursive: true });

    testRepo = join(tempDir, 'test-repo');
    shadowWorktree = join(tempDir, 'shadow-worktree');

    await mkdir(testRepo, { recursive: true });
    const git = new GitAdapter(testRepo);

    // Robust git init
    let initAttempts = 0;
    while (initAttempts < 5) {
      try {
        await git.exec(['init', '--initial-branch=main']);
        // Verify .git exists
        await import('fs/promises').then((fs) => fs.stat(join(testRepo, '.git')));
        break;
      } catch (e) {
        initAttempts++;
        if (initAttempts === 5) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    await git.exec(['config', 'user.name', 'Test User']);
    await git.exec(['config', 'user.email', 'test@example.com']);

    const testFile = join(testRepo, 'test.txt');
    await import('fs/promises').then((fs) => fs.writeFile(testFile, 'initial content\n'));
    await git.exec(['add', '.']);
    await git.exec(['commit', '-m', 'Initial commit']);

    checkpointManager = new CheckpointManager();
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it(
    'should call git update-index --refresh during restoreToShadow',
    async () => {
      const testFile = join(testRepo, 'test.txt');
      await import('fs/promises').then((fs) =>
        fs.writeFile(testFile, 'initial content\nDIRTY_DATA\n'),
      );
      const snapshot = await checkpointManager.createSafeSnapshot(testRepo);

      const git = new GitAdapter(testRepo);
      await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);

      const querySpy = spyOn(GitAdapter.prototype, 'query');

      await checkpointManager.restoreToShadow(testRepo, shadowWorktree, snapshot.commitHash);

      const queryCalls = querySpy.mock.calls as GitQueryCall[];
      const updateIndexCalls = queryCalls.filter(
        ([args]) => args.includes('update-index') && args.includes('--refresh'),
      );

      expect(updateIndexCalls.length).toBeGreaterThan(0);
      querySpy.mockRestore();
    },
    { timeout: 30000 },
  );

  it('should use -uno flag to avoid untracked file scan during status check', async () => {
    const snapshot = await checkpointManager.createSafeSnapshot(testRepo);
    const git = new GitAdapter(testRepo);
    await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);

    const querySpy = spyOn(GitAdapter.prototype, 'query');

    await checkpointManager.restoreToShadow(testRepo, shadowWorktree, snapshot.commitHash);

    const queryCalls = querySpy.mock.calls as GitQueryCall[];
    const statusCalls = queryCalls.filter(([args]) => args.includes('status'));

    expect(statusCalls.length).toBeGreaterThan(0);
    expect(statusCalls[0]?.[0]).toContain('-uno');

    querySpy.mockRestore();
  });

  it('should preserve dirty state after restore (filesystem observability)', async () => {
    const testFile = join(testRepo, 'test.txt');
    await import('fs/promises').then((fs) =>
      fs.writeFile(testFile, 'initial content\nDIRTY_LINE_1\nDIRTY_LINE_2\n'),
    );

    const snapshot = await checkpointManager.createSafeSnapshot(testRepo);
    const git = new GitAdapter(testRepo);
    await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);

    await checkpointManager.restoreToShadow(testRepo, shadowWorktree, snapshot.commitHash);

    const shadowFile = join(shadowWorktree, 'test.txt');
    const content = await import('fs/promises').then((fs) => fs.readFile(shadowFile, 'utf-8'));

    expect(content).toContain('DIRTY_LINE_1');
    expect(content).toContain('DIRTY_LINE_2');
  });
});
