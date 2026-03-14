import { randomBytes } from 'crypto';
import { mkdir, readFile, rm, writeFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';

describe('Snapshot Management Integration (CLI V2 Support)', () => {
  let tempDir: string;
  let repoPath: string;
  let manager: CheckpointManager;

  beforeEach(async () => {
    // Setup isolated test environment
    const randomId = randomBytes(4).toString('hex');
    tempDir = join(tmpdir(), `s8p-snapshot-test-${randomId}`);
    repoPath = join(tempDir, 'repo');

    await mkdir(repoPath, { recursive: true });

    // Init Git
    const git = new GitAdapter(repoPath);
    await git.exec(['init', '--initial-branch=main']);
    await git.exec(['config', 'user.name', 'Test User']);
    await git.exec(['config', 'user.email', 'test@example.com']);

    // Create initial commit
    await writeFile(join(repoPath, 'README.md'), '# Initial');
    await git.exec(['add', '.']);
    await git.exec(['commit', '-m', 'Initial commit']);

    manager = new CheckpointManager();
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should create a snapshot with custom message and metadata', async () => {
    // Arrange: Create a dirty state
    await writeFile(join(repoPath, 'test.txt'), 'dirty content');

    // Act: Create snapshot with message
    const msg = 'Backup before risky op';
    const result = await manager.createSafeSnapshot(repoPath, [], msg);

    // Assert: Verify Ref Namespace (refs/s8p)
    const git = new GitAdapter(repoPath);
    const refExists = await git.exec([
      'rev-parse',
      '--verify',
      `refs/s8p/snapshots/${result.commitHash}`,
    ]);
    expect(refExists.trim()).toBe(result.commitHash);

    // Assert: Verify Metadata in Commit Message
    const commitMsg = await git.exec(['log', '-1', '--format=%B', result.commitHash]);
    const metadata = JSON.parse(commitMsg);
    expect(metadata.v).toBe('1.0');
    expect(metadata.desc).toBe(msg);
  });

  it('should list snapshots correctly with metadata', async () => {
    // Arrange: Create two snapshots
    await writeFile(join(repoPath, 'f1.txt'), 'v1');
    const snap1 = await manager.createSafeSnapshot(repoPath, [], 'First');

    await writeFile(join(repoPath, 'f1.txt'), 'v2');
    const snap2 = await manager.createSafeSnapshot(repoPath, [], 'Second');

    // Act
    const list = await manager.listSnapshots(repoPath);

    // Assert
    expect(list.length).toBe(2);
    // Note: listSnapshots implementation depends on git for-each-ref sort order.
    // Usually sorted by refname. Let's find by hash.
    const item1 = list.find((s) => s.hash.startsWith(snap1.commitHash.substring(0, 7)));
    const item2 = list.find((s) => s.hash.startsWith(snap2.commitHash.substring(0, 7)));

    expect(item1).toBeDefined();
    expect(item2).toBeDefined();

    // Verify we can parse the message back
    const meta1 = JSON.parse(item1!.message);
    expect(meta1.desc).toBe('First');
  });

  it('should export snapshot content to target directory', async () => {
    // Arrange
    await mkdir(join(repoPath, 'src'), { recursive: true });
    await writeFile(join(repoPath, 'src/code.js'), 'console.log("export me")');
    const git = new GitAdapter(repoPath);
    await git.exec(['add', '.']); // Stage it to ensure tree structure
    const snap = await manager.createSafeSnapshot(repoPath);

    // Act
    const exportDir = join(tempDir, 'export-target');
    await manager.exportSnapshot(repoPath, snap.commitHash, exportDir);

    // Assert
    const exportedFile = join(exportDir, 'src/code.js');
    const content = await readFile(exportedFile, 'utf-8');
    expect(content).toBe('console.log("export me")');

    // Assert: Verify no .git directory in export
    const gitDirExists = await stat(join(exportDir, '.git'))
      .then(() => true)
      .catch(() => false);
    expect(gitDirExists).toBe(false);
  });

  it('should delete a specific snapshot', async () => {
    // Arrange
    const snap = await manager.createSafeSnapshot(repoPath);

    // Act
    await manager.deleteSnapshot(repoPath, snap.commitHash);

    // Assert: Ref should be gone
    const git = new GitAdapter(repoPath);
    await expect(
      git.exec(['rev-parse', '--verify', `refs/s8p/snapshots/${snap.commitHash}`]),
    ).rejects.toThrow();
  });

  it('should clear all snapshots', async () => {
    // Arrange
    await manager.createSafeSnapshot(repoPath);
    await manager.createSafeSnapshot(repoPath);

    // Act
    await manager.clearSnapshots(repoPath);

    // Assert
    const list = await manager.listSnapshots(repoPath);
    expect(list.length).toBe(0);
  });

  it('should generate diff between snapshot and workspace', async () => {
    // Arrange: Base state
    await writeFile(join(repoPath, 'file.txt'), 'base\n');
    const git = new GitAdapter(repoPath);
    await git.exec(['add', 'file.txt']);
    await git.exec(['commit', '-m', 'base']);

    // Create snapshot with 'v1'
    await writeFile(join(repoPath, 'file.txt'), 'v1\n');
    const snap = await manager.createSafeSnapshot(repoPath);

    // Modify workspace to 'v2'
    await writeFile(join(repoPath, 'file.txt'), 'v2\n');

    // Act: Diff (Workspace vs Snapshot)
    // Note: getSnapshotDiff(hash) compares hash vs workspace
    const diffStat = await manager.getSnapshotDiff(repoPath, snap.commitHash);

    // Assert
    expect(diffStat).toContain('file.txt');

    // Act: Code diff
    const diffCode = await manager.getSnapshotDiff(repoPath, snap.commitHash, undefined, true);
    // We expect to see change from v1 (snapshot) to v2 (workspace)
    // or v2 to v1 depending on diff order.
    // "git diff <tree-ish>" compares tree-ish to working tree.
    // typically: -snapshot +working
    expect(diffCode).toContain('-v1');
    expect(diffCode).toContain('+v2');
  });

  it('should list all files in a snapshot (ls-files)', async () => {
    // Arrange
    await mkdir(join(repoPath, 'dir'), { recursive: true });
    await writeFile(join(repoPath, 'a.txt'), 'a');
    await writeFile(join(repoPath, 'dir/b.txt'), 'b');

    // Create snapshot including untracked files
    const snap = await manager.createSafeSnapshot(repoPath);

    // Act
    const files = await manager.getSnapshotFiles(repoPath, snap.commitHash);

    // Assert
    expect(files).toContain('a.txt');
    expect(files).toContain('dir/b.txt');
    expect(files).toContain('README.md'); // From initial commit
  });
});
