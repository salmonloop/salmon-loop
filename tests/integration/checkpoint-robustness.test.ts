import { execSync } from 'child_process';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';

// Oracle: The Source of Truth - using raw git commands
const GitOracle = {
  getHeadCommit(repoPath: string): string {
    try {
      return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  },

  getStagedFileSHA(repoPath: string, filePath: string): string | null {
    try {
      return execSync(`git rev-parse :${filePath}`, { cwd: repoPath, encoding: 'utf8' }).trim();
    } catch {
      return null; // Not in index
    }
  },

  fileExistsInCommit(repoPath: string, commitSha: string, filePath: string): boolean {
    try {
      execSync(`git cat-file -e ${commitSha}:${filePath}`, { cwd: repoPath, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  isIgnored(repoPath: string, filePath: string): boolean {
    try {
      const output = execSync(`git check-ignore ${filePath}`, {
        cwd: repoPath,
        encoding: 'utf8',
      }).trim();
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

  const run = (cmd: string, cwd: string = tempRepoPath) => {
    return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
  };

  // Safe join helper directly implemented to avoid import issues if possible,
  // or relying on path.join
  const safeJoin = path.join;

  beforeEach(async () => {
    // 1. Setup Temp Repo
    const randomId = Math.random().toString(36).slice(2);
    tempRepoPath = safeJoin(tmpdir(), `salmon-test-repo-${randomId}`);
    shadowPath = safeJoin(tmpdir(), `salmon-test-shadow-${randomId}`);

    await mkdir(tempRepoPath, { recursive: true });

    // 2. Initialize Git
    run('git init');
    run('git config user.name "Test User"');
    run('git config user.email "test@example.com"');

    // 3. Create Initial Commit
    await writeFile(safeJoin(tempRepoPath, 'file1.txt'), 'initial content');
    // We add .gitignore in test case if needed, but robust base is useful
    await writeFile(safeJoin(tempRepoPath, '.gitignore'), 'node_modules/');
    run('git add file1.txt .gitignore');
    run('git commit -m "Initial commit"');

    manager = new CheckpointManager();
  });

  afterEach(async () => {
    try {
      await rm(tempRepoPath, { recursive: true, force: true });
      await rm(shadowPath, { recursive: true, force: true });
    } catch {
      // Ignore error
    }
  });

  it(
    'should preserve exact state of Staged, Unstaged, and Untracked files',
    { timeout: 30000 },
    async () => {
      // --- Setup Complex State ---

      // 1. Modified Staged (file1.txt)
      await writeFile(safeJoin(tempRepoPath, 'file1.txt'), 'staged content');
      run('git add file1.txt');

      // 2. Modified Unstaged (file1.txt - again)
      // Note: file1 has staged content AND unstaged content
      await writeFile(safeJoin(tempRepoPath, 'file1.txt'), 'unstaged content');

      // 3. New Staged (file2.txt)
      await writeFile(safeJoin(tempRepoPath, 'file2.txt'), 'new staged');
      run('git add file2.txt');

      // 4. Untracked (file3.txt)
      await writeFile(safeJoin(tempRepoPath, 'file3.txt'), 'untracked');

      // 5. Ignored (node_modules/ignored.txt)
      await mkdir(safeJoin(tempRepoPath, 'node_modules'), { recursive: true });
      await writeFile(safeJoin(tempRepoPath, 'node_modules/ignored.txt'), 'ignored');

      // Capture "Truth" (Hashes)
      const getHash = (file: string) => run(`git hash-object ${file}`);

      const expectedStagedFile1 = run('git ls-files -s file1.txt').split(' ')[1];
      const expectedUnstagedFile1 = getHash('file1.txt');
      const expectedUntrackedFile3 = getHash('file3.txt');

      // --- Action: Create Snapshot ---
      const snapshot = await manager.createSafeSnapshot(tempRepoPath);

      // --- Verification 1: Snapshot Created ---
      expect(snapshot.commitHash).toBeDefined();
      // Verify ref exists
      expect(() => run(`git rev-parse refs/s8p/snapshots/${snapshot.commitHash}`)).not.toThrow();

      // --- Action: Destructive Change (Wipe Workspace) ---
      // Reset to HEAD (losing staged/unstaged) and clean untracked
      run('git reset --hard HEAD');
      run('git clean -fd');
      // Verify we lost the state
      expect(run('git status --porcelain')).toBe('');

      // --- Action: Restore ---
      await manager.restoreToMain(tempRepoPath, snapshot.commitHash, true);

      // --- Verification 2: The Oracle (Git Status) ---
      const status = run('git status --porcelain');

      // file1.txt should be MM (Modified in Index, Modified in Worktree)
      // file2.txt should be A  (Added to Index)
      // file3.txt should be ?? (Untracked)
      expect(status).toContain('MM file1.txt');
      expect(status).toContain('A  file2.txt');
      expect(status).toContain('?? file3.txt');

      // --- Verification 3: Content Integrity ---

      // Verify Staged Content of file1
      const actualStagedFile1 = run('git ls-files -s file1.txt').split(' ')[1];
      expect(actualStagedFile1).toBe(expectedStagedFile1);

      // Verify Working Tree Content of file1
      const actualUnstagedFile1 = getHash('file1.txt');
      expect(actualUnstagedFile1).toBe(expectedUnstagedFile1);

      // Verify Untracked Content
      const actualUntrackedFile3 = getHash('file3.txt');
      expect(actualUntrackedFile3).toBe(expectedUntrackedFile3);
    },
  );

  it('Scenario 1: Explicitly including an ignored file should capture it in the snapshot', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    // 0. Update .gitignore to ignore .secret
    await writeFile(safeJoin(tempRepoPath, '.gitignore'), '*.secret\nnode_modules/');
    run('git add .gitignore');
    run('git commit -m "Update ignore"');

    // 1. Setup: Create ignored file
    const secretPath = safeJoin(tempRepoPath, TEST_FILE_NAME);
    await writeFile(secretPath, TEST_FILE_CONTENT);

    // Verification: Ensure it IS ignored by Git
    const isIgnored = GitOracle.isIgnored(tempRepoPath, TEST_FILE_NAME);
    expect(isIgnored).toBe(true);

    // 2. Action: Create snapshot requesting this file
    const result = await manager.createSafeSnapshot(tempRepoPath, [TEST_FILE_NAME]);

    // 3. Oracle Verification (Snapshot Content)
    // The snapshot commit MUST contain the file
    const existsInSnapshot = GitOracle.fileExistsInCommit(
      tempRepoPath,
      result.commitHash,
      TEST_FILE_NAME,
    );
    expect(existsInSnapshot).toBe(true);
  });

  it('Scenario 2: Not requesting an ignored file should strictly exclude it (Implicit Exclusion)', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    await writeFile(safeJoin(tempRepoPath, '.gitignore'), '*.secret\nnode_modules/');
    run('git add .gitignore');
    run('git commit -m "Update ignore"');

    // 1. Setup: Create ignored file
    const secretPath = safeJoin(tempRepoPath, TEST_FILE_NAME);
    await writeFile(secretPath, TEST_FILE_CONTENT);

    // 2. Action: Create snapshot WITHOUT requesting the secret file
    const result = await manager.createSafeSnapshot(tempRepoPath, []); // Empty include list

    // 3. Oracle Verification
    const existsInSnapshot = GitOracle.fileExistsInCommit(
      tempRepoPath,
      result.commitHash,
      TEST_FILE_NAME,
    );
    expect(existsInSnapshot).toBe(false);
  });

  it('Scenario 3: Restoring a snapshot with forced ignored files to Shadow Worktree', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    await writeFile(safeJoin(tempRepoPath, '.gitignore'), '*.secret\nnode_modules/');
    run('git add .gitignore');
    run('git commit -m "Update ignore"');

    // 1. Setup & Snapshot
    const secretPath = safeJoin(tempRepoPath, TEST_FILE_NAME);
    await writeFile(secretPath, TEST_FILE_CONTENT);
    const snapshot = await manager.createSafeSnapshot(tempRepoPath, [TEST_FILE_NAME]);

    // 2. Prepare Shadow Worktree manual setup since we don't have WorkspaceManager here
    run(`git worktree add --quiet ${shadowPath} ${snapshot.commitHash}`);

    // 3. Action: Restore
    await manager.restoreToShadow(tempRepoPath, shadowPath, snapshot.commitHash);

    // 4. Oracle Verification
    // The file should exist in the shadow directory
    const shadowFilePath = safeJoin(shadowPath, TEST_FILE_NAME);
    // basic check using node fs
    try {
      const content = await readFile(shadowFilePath, 'utf-8');
      expect(content).toBe(TEST_FILE_CONTENT);
    } catch (e) {
      throw new Error(`File not restored to shadow: ${e}`);
    }
  });

  it('Scenario 4: Mixed State - Staged changes + Ignored file', async () => {
    const TEST_FILE_NAME = 'app.secret';
    const TEST_FILE_CONTENT = 'super_secret_key=12345';

    await writeFile(safeJoin(tempRepoPath, '.gitignore'), '*.secret\nnode_modules/');
    run('git add .gitignore');
    run('git commit -m "Update ignore"');

    // 1. Setup
    // - Modify a tracked file and Stage it
    const readmePath = safeJoin(tempRepoPath, 'file1.txt'); // use file1
    await writeFile(readmePath, '# Updated Readme');
    run('git add file1.txt');
    const stagedShaBefore = GitOracle.getStagedFileSHA(tempRepoPath, 'file1.txt');

    // - Create ignored file
    const secretPath = safeJoin(tempRepoPath, TEST_FILE_NAME);
    await writeFile(secretPath, TEST_FILE_CONTENT);

    // 2. Action
    const snapshot = await manager.createSafeSnapshot(tempRepoPath, [TEST_FILE_NAME]);

    // 3. Oracle Verification
    // - Ignored file captured?
    expect(GitOracle.fileExistsInCommit(tempRepoPath, snapshot.commitHash, TEST_FILE_NAME)).toBe(
      true,
    );

    // - Staged state preserved in metadata?
    // We verify that the user's staged index was NOT modified by the snapshot process
    const stagedShaAfter = GitOracle.getStagedFileSHA(tempRepoPath, 'file1.txt');
    expect(stagedShaAfter).toBe(stagedShaBefore);
  });

  it('should list snapshots and retrieve details correctly', async () => {
    // 1. Create first snapshot
    await writeFile(safeJoin(tempRepoPath, 'file1.txt'), 'v1');
    run('git add file1.txt');
    const snap1 = await manager.createSafeSnapshot(tempRepoPath);

    // Sleep to ensure timestamp difference (optional, but good for ordering if dependent)
    await new Promise((r) => setTimeout(r, 10));

    // 2. Create second snapshot
    await writeFile(safeJoin(tempRepoPath, 'file1.txt'), 'v2'); // Unstaged change
    await writeFile(safeJoin(tempRepoPath, 'file2.txt'), 'staged v2');
    run('git add file2.txt');
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
    await writeFile(safeJoin(tempRepoPath, 'dirty.txt'), 'I am dirty');

    // 3. Try access restore without force -> Should Fail
    await expect(manager.restoreToMain(tempRepoPath, snap.commitHash)).rejects.toThrow(
      'Workspace is dirty',
    );

    // 4. Try access restore WITH force -> Should Succeed
    await expect(manager.restoreToMain(tempRepoPath, snap.commitHash, true)).resolves.not.toThrow();

    // Verify it's actually restored (dirty file gone or ignored? Reset --hard usually cleans tracked, but verify logic)
    // transform: reset --soft PARENT, checkout SNAPSHOT.
    // If 'dirty.txt' is untracked, checkout might fail if it would be overwritten, or preserve it.
    // CheckpointManager.restoreToMain uses `checkout snapshot -- .`
    // If dirty.txt was untracked and not in snapshot, it stays.
    // If we modified a tracked file...

    // Let's create a DIRTY TRACKED file for robust test
    await writeFile(safeJoin(tempRepoPath, 'file1.txt'), 'dirty tracked');
    // Note: file1 is tracked.
    await expect(manager.restoreToMain(tempRepoPath, snap.commitHash)).rejects.toThrow();
    await manager.restoreToMain(tempRepoPath, snap.commitHash, true);

    const content = await readFile(safeJoin(tempRepoPath, 'file1.txt'), 'utf-8');
    expect(content).not.toBe('dirty tracked');
  });
});
