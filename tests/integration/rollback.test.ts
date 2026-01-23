/**
 * Rollback Integration Tests - Using REAL filesystem
 *
 * Tests rollback functionality with real Git operations.
 *
 * This follows the "source is truth" principle:
 * - Uses real Git repositories
 * - Tests actual rollback scenarios
 * - No mocks for Git operations
 */

import { rm } from 'fs/promises';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { rollbackFiles } from '../../src/core/git.js';
import { logger } from '../../src/core/logger.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Rollback Integration Tests (Real Filesystem)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should rollback specific files', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'file1.ts', content: 'original 1' },
        { path: 'file2.ts', content: 'original 2' },
        { path: 'file3.ts', content: 'original 3' },
      ],
    });

    // Modify all files
    await helper.modifyFile(repo.path, 'file1.ts', 'modified 1');
    await helper.modifyFile(repo.path, 'file2.ts', 'modified 2');
    await helper.modifyFile(repo.path, 'file3.ts', 'modified 3');

    // Rollback only file1 and file2
    const result = await rollbackFiles(repo.path, ['file1.ts', 'file2.ts']);

    if (result.stderr) {
      logger.debug(`Rollback stderr: ${result.stderr}`);
    }

    expect(result.ok).toBe(true);
    expect(result.attempted).toContain('file1.ts');
    expect(result.attempted).toContain('file2.ts');

    // Verify file1 and file2 are rolled back
    const content1 = await helper.readFile(repo.path, 'file1.ts');
    const content2 = await helper.readFile(repo.path, 'file2.ts');
    expect(content1).toBe('original 1');
    expect(content2).toBe('original 2');

    // Verify file3 is still modified
    const content3 = await helper.readFile(repo.path, 'file3.ts');
    expect(content3).toBe('modified 3');
  });

  it('should perform hard reset and clean', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'tracked.js', content: 'tracked content' }],
    });

    // Create various dirty states
    await helper.modifyFile(repo.path, 'tracked.js', 'modified tracked');
    await helper.writeFile(repo.path, 'untracked.js', 'untracked file');
    await helper.writeFile(repo.path, 'nested/deep/untracked.js', 'nested untracked');

    // Verify dirty state
    let status = await helper.getGitStatus(repo.path);
    expect(status).toContain('tracked.js');
    expect(status).toContain('untracked.js');

    // Force reset (reset --hard + clean -fd)
    const result = await rollbackFiles(repo.path, [], true);

    expect(result.ok).toBe(true);

    // Verify tracked file is restored
    const trackedContent = await helper.readFile(repo.path, 'tracked.js');
    expect(trackedContent).toBe('tracked content');

    // Verify untracked files are removed
    const untrackedExists = await helper.fileExists(repo.path, 'untracked.js');
    expect(untrackedExists).toBe(false);

    const nestedExists = await helper.fileExists(repo.path, 'nested/deep/untracked.js');
    expect(nestedExists).toBe(false);

    // Verify workspace is clean
    status = await helper.getGitStatus(repo.path);
    expect(status.trim()).toBe('');
  });

  it('should handle rollback with staged changes', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'file.ts', content: 'original' }],
    });

    // Modify and stage file
    await helper.modifyFile(repo.path, 'file.ts', 'staged changes', true);

    // Verify it's staged
    let status = await helper.getGitStatus(repo.path);
    expect(status).toContain('M  file.ts'); // Staged

    // Rollback
    // CRITICAL TEST: We explicitly pass 'HEAD' here to verify we can force-revert to the commit state.
    // Note that standard agent rollback (no ref) behaves differently (reverts to Index) to protect staged changes.
    const result = await rollbackFiles(repo.path, ['file.ts'], false, 'HEAD');

    expect(result.ok).toBe(true);

    // Verify file is restored to original
    const content = await helper.readFile(repo.path, 'file.ts');
    expect(content).toBe('original');

    // Verify workspace is clean
    status = await helper.getGitStatus(repo.path);
    expect(status.trim()).toBe('');
  });

  it('should handle rollback with both staged and unstaged changes', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'file.ts', content: 'original' }],
    });

    // Stage one change
    await helper.modifyFile(repo.path, 'file.ts', 'staged change', true);

    // Make another unstaged change
    await helper.modifyFile(repo.path, 'file.ts', 'unstaged change');

    // Verify mixed state
    const status = await helper.getGitStatus(repo.path);
    expect(status).toContain('file.ts');

    // Rollback
    // CRITICAL TEST: We explicitly pass 'HEAD' here to verify we can force-revert to the commit state.
    // Note that standard agent rollback (no ref) behaves differently (reverts to Index) to protect staged changes.
    const result = await rollbackFiles(repo.path, ['file.ts'], false, 'HEAD');

    expect(result.ok).toBe(true);

    // Verify file is restored
    const content = await helper.readFile(repo.path, 'file.ts');
    expect(content).toBe('original');
  });

  it('should rollback deleted files', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'deleted.ts', content: 'to be deleted' }],
    });

    // Verify it's created and tracked
    const initialStatus = await helper.getGitStatus(repo.path);
    if (initialStatus.includes('?? deleted.ts') || initialStatus.includes('A  deleted.ts')) {
      // It might be added but not committed if something went wrong, but helper.createGitRepo commits.
      // just ensuring it's not unknown.
    }

    // Delete the file (unstaged)
    await rm(join(repo.path, 'deleted.ts'));

    // Verify it's deleted from filesystem
    const exists = await helper.fileExists(repo.path, 'deleted.ts');
    expect(exists).toBe(false);

    // Rollback (restores from index)
    const result = await rollbackFiles(repo.path, ['deleted.ts']);

    if (!result.ok) {
      logger.error(`Rollback failed: ${result.stderr}`);
    }

    expect(result.ok).toBe(true);

    // Verify file is restored
    const restoredExists = await helper.fileExists(repo.path, 'deleted.ts');
    expect(restoredExists).toBe(true);

    const content = await helper.readFile(repo.path, 'deleted.ts');
    expect(content).toBe('to be deleted');
  });

  it('should rollback to specific ref when provided', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'file.ts', content: 'version 1' }],
    });

    // Create second commit
    await helper.modifyFile(repo.path, 'file.ts', 'version 2');
    const commit2 = await helper.createCommit(repo.path, 'Version 2');

    // Create third commit
    await helper.modifyFile(repo.path, 'file.ts', 'version 3');
    await helper.createCommit(repo.path, 'Version 3');

    // Verify current content
    let content = await helper.readFile(repo.path, 'file.ts');
    expect(content).toBe('version 3');

    // Rollback to commit2 using shadowRef
    // Passing commit hash explicitly
    const result = await rollbackFiles(repo.path, ['file.ts'], false, commit2);

    expect(result.ok).toBe(true);

    // Verify file is at version 2
    content = await helper.readFile(repo.path, 'file.ts');
    expect(content).toBe('version 2');
  });

  it('should handle empty file list gracefully', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'file.ts', content: 'content' }],
    });

    // Modify file
    await helper.modifyFile(repo.path, 'file.ts', 'modified');

    // Rollback with empty file list (no-op without forceReset)
    const result = await rollbackFiles(repo.path, [], false);

    expect(result.ok).toBe(true);
    expect(result.attempted).toEqual([]);

    // Verify file is still modified
    const content = await helper.readFile(repo.path, 'file.ts');
    expect(content).toBe('modified');
  });

  it('should handle non-existent files gracefully', async () => {
    const repo = await helper.createGitRepo();

    // Try to rollback non-existent file
    const result = await rollbackFiles(repo.path, ['non-existent.ts']);

    // Should still succeed (git checkout will just skip it)
    expect(result.ok).toBe(true);
  });

  it('should not rollback files outside repository', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'safe.ts', content: 'safe file' }],
    });

    // Try to rollback with path traversal
    const result = await rollbackFiles(repo.path, ['../outside.ts', '../../outside.ts', 'safe.ts']);

    // Should only include safe file
    expect(result.attempted).toContain('safe.ts');
    expect(result.attempted).not.toContain('../outside.ts');
    expect(result.attempted).not.toContain('../../outside.ts');
  });
});
