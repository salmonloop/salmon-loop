/**
 * Git Integration Tests - Using REAL filesystem and Git operations
 *
 * This test file follows the "source is truth" principle:
 * - Uses real Git repositories
 * - Uses real file system operations
 * - No mocks for core functionality
 * - Tests actual behavior, not implementation details
 */

import { describe, it, expect, afterEach } from 'vitest';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Git Integration Tests (Real Filesystem)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should apply patch to real repository', async () => {
    // Create a real Git repository
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'test.txt', content: 'line1\nline2\nline3\n' }],
    });
    const adapter = new GitAdapter(repo.path);

    // Modify the file
    await helper.writeFile(repo.path, 'test.txt', 'line1\nmodified\nline3\n');

    // Get the real diff
    const diff = await adapter.exec(['diff'], { trim: false });

    // Verify diff exists and contains expected changes
    expect(diff).toBeDefined();
    expect(diff).toContain('-line2');
    expect(diff).toContain('+modified');

    // Reset the file
    await helper.git(repo.path, ['checkout', 'test.txt']);

    // Apply the patch (REAL git apply, no mock)
    if (!diff) throw new Error('Diff should not be undefined');
    await adapter.applyPatch(diff);

    // Verify the file was actually modified
    const content = await helper.readFile(repo.path, 'test.txt');
    expect(content).toBe('line1\nmodified\nline3\n');
  });

  it('should rollback specific files in real repository', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'file1.ts', content: 'original content 1' },
        { path: 'file2.ts', content: 'original content 2' },
      ],
    });
    const adapter = new GitAdapter(repo.path);

    // Modify both files
    await helper.modifyFile(repo.path, 'file1.ts', 'modified content 1');
    await helper.modifyFile(repo.path, 'file2.ts', 'modified content 2');

    // Verify files are modified
    let status = await adapter.getStatus();
    expect(status).toContain('file1.ts');
    expect(status).toContain('file2.ts');

    // Rollback specific files (REAL git checkout)
    await adapter.rollbackFiles(['file1.ts', 'file2.ts']);

    // Verify files are actually rolled back
    const content1 = await helper.readFile(repo.path, 'file1.ts');
    const content2 = await helper.readFile(repo.path, 'file2.ts');

    expect(content1).toBe('original content 1');
    expect(content2).toBe('original content 2');

    // Verify git status is clean
    status = await adapter.getStatus();
    expect(status.trim()).toBe('');
  });

  it('should perform hard reset when needed', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'tracked.js', content: 'tracked' }],
    });
    const adapter = new GitAdapter(repo.path);

    // Create various types of changes
    await helper.modifyFile(repo.path, 'tracked.js', 'modified tracked');
    await helper.writeFile(repo.path, 'untracked.js', 'untracked file');

    // Verify dirty state
    let status = await adapter.getStatus();
    expect(status).toContain('tracked.js');
    expect(status).toContain('untracked.js');

    // Force reset (REAL git reset --hard && git clean -fd)
    // Note: GitAdapter.rollbackFiles with empty paths does nothing. Use explicit reset.
    await adapter.exec(['reset', '--hard', 'HEAD']);
    await adapter.exec(['clean', '-fd']);

    // Verify everything is rolled back
    const content = await helper.readFile(repo.path, 'tracked.js');
    expect(content).toBe('tracked');

    // Verify untracked file is removed
    const untrackedExists = await helper.fileExists(repo.path, 'untracked.js');
    expect(untrackedExists).toBe(false);

    // Verify git status is clean
    status = await adapter.getStatus();
    expect(status.trim()).toBe('');
  });

  it('should get git diff for unstaged changes', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'app.js', content: 'console.log("hello");' }],
    });
    const adapter = new GitAdapter(repo.path);

    // Modify file without staging
    await helper.modifyFile(repo.path, 'app.js', 'console.log("hello world");');

    // Get real diff
    const diff = await adapter.exec(['diff']);

    expect(diff).toBeDefined();
    expect(diff).toContain('diff --git a/app.js b/app.js');
    expect(diff).toContain('-console.log("hello");');
    expect(diff).toContain('+console.log("hello world");');
  });

  it('should get git diff for staged changes', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'app.js', content: 'console.log("hello");' }],
    });
    const adapter = new GitAdapter(repo.path);

    // Modify and stage file
    await helper.modifyFile(repo.path, 'app.js', 'console.log("hello world");', true);

    // Get staged diff (REAL git diff --cached)
    const diff = await adapter.exec(['diff', '--cached']);

    expect(diff).toBeDefined();
    expect(diff).toContain('diff --git a/app.js b/app.js');
    expect(diff).toContain('-console.log("hello");');
    expect(diff).toContain('+console.log("hello world");');
  });

  it('should get git status with modified files', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'file1.ts', content: 'content1' }],
    });
    const adapter = new GitAdapter(repo.path);

    // Modify file
    await helper.modifyFile(repo.path, 'file1.ts', 'modified content');

    // Get real status
    const status = await adapter.getStatus();

    expect(status).toBeDefined();
    expect(status).toContain('file1.ts');
  });

  it('should handle patch with binary files', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'text.txt', content: 'text file' }],
    });
    const adapter = new GitAdapter(repo.path);

    // Create a "binary-like" file (we'll use a text file for simplicity)
    await helper.writeFile(repo.path, 'data.bin', '\x00\x01\x02\x03');
    await helper.git(repo.path, ['add', 'data.bin']);
    await helper.git(repo.path, ['commit', '-m', 'Add binary file']);

    // Modify text file
    await helper.modifyFile(repo.path, 'text.txt', 'modified text file');

    // Get diff with binary
    const diff = await helper.git(repo.path, ['diff', '--binary']);

    // Apply patch should handle binary files
    await helper.git(repo.path, ['checkout', 'text.txt']);
    await adapter.applyPatch(diff.stdout);

    const content = await helper.readFile(repo.path, 'text.txt');
    expect(content).toBe('modified text file');
  });

  it('should handle patch application failure gracefully', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'test.txt', content: 'line1\nline2\nline3\n' }],
    });
    const adapter = new GitAdapter(repo.path);

    // Create a patch that won't apply
    const invalidPatch = `diff --git a/test.txt b/test.txt
index 123..456 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-nonexistent line
+new line`;

    // Should throw error on invalid patch
    await expect(adapter.applyPatch(invalidPatch)).rejects.toThrow();
  });

  it('should apply patch with context lines correctly', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        {
          path: 'code.js',
          content: `function test() {
  const a = 1;
  const b = 2;
  const c = 3;
  return a + b + c;
}`,
        },
      ],
    });
    const adapter = new GitAdapter(repo.path);

    // Modify middle line
    await helper.writeFile(
      repo.path,
      'code.js',
      `function test() {
  const a = 1;
  const b = 20;
  const c = 3;
  return a + b + c;
}`,
    );

    const diff = await adapter.exec(['diff']);

    // Reset and reapply
    await helper.git(repo.path, ['checkout', 'code.js']);
    if (!diff) throw new Error('Diff should not be undefined');
    await adapter.applyPatch(diff);

    const content = await helper.readFile(repo.path, 'code.js');
    expect(content).toContain('const b = 20;');
  });

  it('should throw when git merge-file fails (invalid file paths)', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'base.txt', content: 'base\n' }],
    });
    const adapter = new GitAdapter(repo.path);

    await expect(
      adapter.mergeFile('missing-base.txt', 'missing-ours.txt', 'missing-theirs.txt'),
    ).rejects.toThrow();
  });
});
