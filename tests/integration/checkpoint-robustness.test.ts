import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

// Oracle: The Source of Truth - using raw git commands
const helper = new RealFsTestHelper();
const runGit = async (repoPath: string, args: string[]): Promise<string> => {
  const result = await helper.git(repoPath, args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
};

const GitOracle = {
  async getHeadCommit(repoPath: string): Promise<string> {
    try {
      return await runGit(repoPath, ['rev-parse', 'HEAD']);
    } catch {
      return '';
    }
  },

  async getStagedFileSHA(repoPath: string, filePath: string): Promise<string | null> {
    try {
      return await runGit(repoPath, ['rev-parse', `:${filePath}`]);
    } catch {
      return null; // Not in index
    }
  },

  async fileExistsInCommit(
    repoPath: string,
    commitSha: string,
    filePath: string,
  ): Promise<boolean> {
    try {
      await runGit(repoPath, ['cat-file', '-e', `${commitSha}:${filePath}`]);
      return true;
    } catch {
      return false;
    }
  },

  async isIgnored(repoPath: string, filePath: string): Promise<boolean> {
    try {
      const output = await runGit(repoPath, ['check-ignore', filePath]);
      return !!output;
    } catch {
      return false;
    }
  },
};

describe('Checkpoint System (Real Git Integration)', () => {
  let tempRepoPath: string;
  let shadowPath: string;
  let manager: CheckpointManager;

  const run = async (args: string[], cwd: string = tempRepoPath) => {
    return runGit(cwd, args);
  };

  beforeEach(async () => {
    // 1. Setup Temp Repo
    const repo = await helper.createGitRepo({
      prefix: 'salmon-test-repo-',
      initialFiles: [
        { path: 'file1.txt', content: 'initial content' },
        { path: '.gitignore', content: 'node_modules/' },
      ],
    });
    tempRepoPath = repo.path;
    shadowPath = await helper.createTempDir('salmon-test-shadow-');

    manager = new CheckpointManager();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it(
    'should preserve exact state of Staged, Unstaged, and Untracked files',
    async () => {
      // --- Setup Complex State ---

      // 1. Modified Staged (file1.txt)
      await helper.writeFile(tempRepoPath, 'file1.txt', 'staged content');
      await run(['add', 'file1.txt']);

      // 2. Modified Unstaged (file1.txt - again)
      // Note: file1 has staged content AND unstaged content
      await helper.writeFile(tempRepoPath, 'file1.txt', 'unstaged content');

      // 3. New Staged (file2.txt)
      await helper.writeFile(tempRepoPath, 'file2.txt', 'new staged');
      await run(['add', 'file2.txt']);

      // 4. Untracked (file3.txt)
      await helper.writeFile(tempRepoPath, 'file3.txt', 'untracked');

      // 5. Ignored (node_modules/ignored.txt)
      await helper.writeFile(tempRepoPath, 'node_modules/ignored.txt', 'ignored');

      // Capture "Truth" (Hashes)
      const getHash = (file: string) => run(['hash-object', file]);

      const expectedStagedFile1 = (await run(['ls-files', '-s', 'file1.txt'])).split(' ')[1];
      const expectedUnstagedFile1 = await getHash('file1.txt');
      const expectedUntrackedFile3 = await getHash('file3.txt');

      // --- Action: Create Snapshot ---
      const snapshot = await manager.createSafeSnapshot(tempRepoPath);

      // --- Verification 1: Snapshot Created ---
      expect(snapshot.commitHash).toBeDefined();
      // Verify ref exists
      await expect(
        run(['rev-parse', `refs/s8p/snapshots/${snapshot.commitHash}`]),
      ).resolves.toMatch(/^[0-9a-f]{40}$/);

      // --- Action: Destructive Change (Wipe Workspace) ---
      // Reset to HEAD (losing staged/unstaged) and clean untracked
      await run(['reset', '--hard', 'HEAD']);
      await run(['clean', '-fd']);
      // Verify we lost the state
      expect(await run(['status', '--porcelain'])).toBe('');

      // --- Action: Restore ---
      await manager.restoreToMain(tempRepoPath, snapshot.commitHash, true);

      // --- Verification 2: The Oracle (Git Status) ---
      const status = await run(['status', '--porcelain']);

      // file1.txt should be MM (Modified in Index, Modified in Worktree)
      // file2.txt should be A  (Added to Index)
      // file3.txt should be ?? (Untracked)
      expect(status).toContain('MM file1.txt');
      expect(status).toContain('A  file2.txt');
      expect(status).toContain('?? file3.txt');

      // --- Verification 3: Content Integrity ---

      // Verify Staged Content of file1
      const actualStagedFile1 = (await run(['ls-files', '-s', 'file1.txt'])).split(' ')[1];
      expect(actualStagedFile1).toBe(expectedStagedFile1);

      // Verify Working Tree Content of file1
      const actualUnstagedFile1 = await getHash('file1.txt');
      expect(actualUnstagedFile1).toBe(expectedUnstagedFile1);

      // Verify Untracked Content
      const actualUntrackedFile3 = await getHash('file3.txt');
      expect(actualUntrackedFile3).toBe(expectedUntrackedFile3);
    },
    { timeout: 30000 },
  );

  it('Scenario 1: Explicitly including an ignored file should capture it in the snapshot', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    // 0. Update .gitignore to ignore .secret
    await helper.writeFile(tempRepoPath, '.gitignore', '*.secret\nnode_modules/');
    await run(['add', '.gitignore']);
    await run(['commit', '-m', 'Update ignore']);

    // 1. Setup: Create ignored file
    await helper.writeFile(tempRepoPath, TEST_FILE_NAME, TEST_FILE_CONTENT);

    // Verification: Ensure it IS ignored by Git
    const isIgnored = await GitOracle.isIgnored(tempRepoPath, TEST_FILE_NAME);
    expect(isIgnored).toBe(true);

    // 2. Action: Create snapshot requesting this file
    const result = await manager.createSafeSnapshot(tempRepoPath, [TEST_FILE_NAME]);

    // 3. Oracle Verification (Snapshot Content)
    // The snapshot commit MUST contain the file
    const existsInSnapshot = await GitOracle.fileExistsInCommit(
      tempRepoPath,
      result.commitHash,
      TEST_FILE_NAME,
    );
    expect(existsInSnapshot).toBe(true);
  });

  it('Scenario 2: Not requesting an ignored file should strictly exclude it (Implicit Exclusion)', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    await helper.writeFile(tempRepoPath, '.gitignore', '*.secret\nnode_modules/');
    await run(['add', '.gitignore']);
    await run(['commit', '-m', 'Update ignore']);

    // 1. Setup: Create ignored file
    await helper.writeFile(tempRepoPath, TEST_FILE_NAME, TEST_FILE_CONTENT);

    // 2. Action: Create snapshot WITHOUT requesting the secret file
    const result = await manager.createSafeSnapshot(tempRepoPath, []); // Empty include list

    // 3. Oracle Verification
    const existsInSnapshot = await GitOracle.fileExistsInCommit(
      tempRepoPath,
      result.commitHash,
      TEST_FILE_NAME,
    );
    expect(existsInSnapshot).toBe(false);
  });

  it('Scenario 3: Restoring a snapshot with forced ignored files to Shadow Worktree', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    await helper.writeFile(tempRepoPath, '.gitignore', '*.secret\nnode_modules/');
    await run(['add', '.gitignore']);
    await run(['commit', '-m', 'Update ignore']);

    // 1. Setup & Snapshot
    await helper.writeFile(tempRepoPath, TEST_FILE_NAME, TEST_FILE_CONTENT);
    const snapshot = await manager.createSafeSnapshot(tempRepoPath, [TEST_FILE_NAME]);

    // 2. Prepare Shadow Worktree manual setup since we don't have WorkspaceManager here
    await run(['worktree', 'add', '--quiet', shadowPath, snapshot.commitHash]);

    // 3. Action: Restore
    await manager.restoreToShadow(tempRepoPath, shadowPath, snapshot.commitHash);

    // 4. Oracle Verification
    // The file should exist in the shadow directory
    // basic check using node fs
    try {
      const content = (await helper.readFile(shadowPath, TEST_FILE_NAME)) as string;
      expect(content).toBe(TEST_FILE_CONTENT);
    } catch (e) {
      throw new Error(`File not restored to shadow: ${e}`);
    }
  });

  it('Scenario 4: Mixed State - Staged changes + Ignored file', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    await helper.writeFile(tempRepoPath, '.gitignore', '*.secret\nnode_modules/');
    await run(['add', '.gitignore']);
    await run(['commit', '-m', 'Update ignore']);

    // 1. Setup
    // - Modify a tracked file and Stage it
    await helper.writeFile(tempRepoPath, 'file1.txt', '# Updated Readme');
    await run(['add', 'file1.txt']);
    const stagedShaBefore = await GitOracle.getStagedFileSHA(tempRepoPath, 'file1.txt');

    // - Create ignored file
    await helper.writeFile(tempRepoPath, TEST_FILE_NAME, TEST_FILE_CONTENT);

    // 2. Action
    const snapshot = await manager.createSafeSnapshot(tempRepoPath, [TEST_FILE_NAME]);

    // 3. Oracle Verification
    // - Ignored file captured?
    expect(
      await GitOracle.fileExistsInCommit(tempRepoPath, snapshot.commitHash, TEST_FILE_NAME),
    ).toBe(true);

    // - Staged state preserved in metadata?
    // We verify that the user's staged index was NOT modified by the snapshot process
    const stagedShaAfter = await GitOracle.getStagedFileSHA(tempRepoPath, 'file1.txt');
    expect(stagedShaAfter).toBe(stagedShaBefore);
  });

  it('should list snapshots and retrieve details correctly', async () => {
    // 1. Create first snapshot
    await helper.writeFile(tempRepoPath, 'file1.txt', 'v1');
    await run(['add', 'file1.txt']);
    const snap1 = await manager.createSafeSnapshot(tempRepoPath);

    // 2. Create second snapshot
    await helper.writeFile(tempRepoPath, 'file1.txt', 'v2'); // Unstaged change
    await helper.writeFile(tempRepoPath, 'file2.txt', 'staged v2');
    await run(['add', 'file2.txt']);
    const snap2 = await manager.createSafeSnapshot(tempRepoPath);

    // 3. Test listSnapshots
    const list = await manager.listSnapshots(tempRepoPath);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.find((s) => s.hash.startsWith(snap1.commitHash.substring(0, 7)))).toBeDefined();
    expect(list.find((s) => s.hash.startsWith(snap2.commitHash.substring(0, 7)))).toBeDefined();

    // 4. Test getSnapshotDetails for Snap2
    // Snap2 state:
    // Staged: file1 (v1 from prev), file2 (staged v2) - Wait.
    // In Snap2 creation:
    //   Index at that moment contained:
    //     file1: v1 (from previous add, unless reset? No, we didn't reset)
    //     file2: staged v2
    //   Worktree:
    //     file1: v2 (modified)
    //
    // Let's verify exactly what was in the index for Snap2.
    // We did `git add file1.txt` with 'v1'. Then snapshot 1.
    // Then `writeFile file1 'v2'` (no add).
    // Then `writeFile file2 'staged v2'` + `add`.
    // So Index has: file1=v1, file2=v2.
    // Worktree has: file1=v2.
    //
    // Snapshot records:
    //   Staged Tree: file1=v1, file2=v2
    //   Target Commit (Working Tree): file1=v2, file2=v2
    //
    // getSnapshotDetails compares:
    //   Staged Files = Diff(Parent, StagedTree)
    //     Parent (HEAD) had file1=v1 (from 'Initial commit'? No, see Setup)
    //     Wait, Setup created 'Initial commit' with file1='initial content'.
    //     We modified file1 to 'v1' and added.
    //     So Staged vs Parent: file1 modified. file2 added.
    //   Unstaged Files = Diff(StagedTree, SnapshotCommit)
    //     StagedTree: file1=v1
    //     Snapshot: file1=v2
    //     Diff: file1 modified.

    const details = await manager.getSnapshotDetails(tempRepoPath, snap2.commitHash);
    expect(details.stagedFiles).toContain('file1.txt'); // Modified in index vs HEAD
    expect(details.stagedFiles).toContain('file2.txt'); // New in index
    expect(details.unstagedFiles).toContain('file1.txt'); // Modified in worktree vs index
    expect(details.unstagedFiles).not.toContain('file2.txt'); // Same in worktree and index

    // 5. Test getSnapshotFileContent
    const file1Content = await manager.getSnapshotFileContent(
      tempRepoPath,
      snap2.commitHash,
      'file1.txt',
    );
    expect(file1Content).toBe('v2');
  });

  it('should enforce dirty check on restoreToMain unless forced', async () => {
    // 1. Create snapshot
    const snap = await manager.createSafeSnapshot(tempRepoPath);

    // 2. Make workspace dirty
    await helper.writeFile(tempRepoPath, 'dirty.txt', 'I am dirty');

    // 3. Try access restore without force -> Should Fail
    await expect(manager.restoreToMain(tempRepoPath, snap.commitHash)).rejects.toThrow(
      'Workspace is dirty',
    );

    // 4. Try access restore WITH force -> Should Succeed
    await expect(
      manager.restoreToMain(tempRepoPath, snap.commitHash, true),
    ).resolves.toBeUndefined();

    // Verify it's actually restored (dirty file gone or ignored? Reset --hard usually cleans tracked, but verify logic)
    // transform: reset --soft PARENT, checkout SNAPSHOT.
    // If 'dirty.txt' is untracked, checkout might fail if it would be overwritten, or preserve it.
    // CheckpointManager.restoreToMain uses `checkout snapshot -- .`
    // If dirty.txt was untracked and not in snapshot, it stays.
    // If we modified a tracked file...

    // Let's create a DIRTY TRACKED file for robust test
    await helper.writeFile(tempRepoPath, 'file1.txt', 'dirty tracked');
    // Note: file1 is tracked.
    await expect(manager.restoreToMain(tempRepoPath, snap.commitHash)).rejects.toThrow();
    await manager.restoreToMain(tempRepoPath, snap.commitHash, true);

    const content = (await helper.readFile(tempRepoPath, 'file1.txt')) as string;
    expect(content).not.toBe('dirty tracked');
  });
});
