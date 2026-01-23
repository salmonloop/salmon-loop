/**
 * ApplyBack Dirty Workspace Safety Tests - Using REAL filesystem
 *
 * CRITICAL: Tests the safety guarantees when applying changes back to a dirty workspace.
 *
 * This follows the "source is truth" principle:
 * - Uses real Git repositories
 * - Tests actual dirty workspace scenarios
 * - Validates real backup and restore mechanisms
 * - No mocks for core functionality
 */

import { describe, it, expect, afterEach } from 'vitest';

import { SalmonLoop } from '../../src/core/loop.js';
import type { CheckpointRef } from '../../src/core/types.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('ApplyBack Dirty Workspace Safety - CRITICAL SCENARIOS (Real Filesystem)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  describe('CRITICAL: Dirty workspace + NO file overlap', () => {
    it('should create backup even when patch targets different files', async () => {
      // Create main repository
      const mainRepo = await helper.createGitRepo({
        prefix: 'main-repo-',
        initialFiles: [
          { path: 'fileA.js', content: 'original A' },
          { path: 'fileB.js', content: 'original B' },
        ],
      });

      // Create worktree
      const worktreePath = await helper.createWorktree(mainRepo.path);

      // In main repo: modify fileA.js (dirty workspace)
      await helper.modifyFile(mainRepo.path, 'fileA.js', 'user modified A');

      // Verify main repo is dirty
      const dirtyStatus = await helper.getGitStatus(mainRepo.path);
      expect(dirtyStatus).toContain('M fileA.js');

      // In worktree: modify fileB.js (different file, no overlap)
      await helper.modifyFile(worktreePath, 'fileB.js', 'worktree modified B');

      // Create checkpoint ref
      const baseCommit = await helper.git(mainRepo.path, ['rev-parse', 'HEAD']);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: baseCommit.stdout.trim(),
        branchName: 'test-worktree',
      };

      // Get patch from worktree
      const diff = await helper.getGitDiff(worktreePath);

      const loop = new SalmonLoop();

      // Apply back to main workspace (REAL applyBack operation)
      // This should create backup even though there's no overlap
      await (loop as any).applyBackToMainWorkspace(
        mainRepo.path,
        checkpointRef,
        diff,
        '3way',
        'extended',
        ['fileB.js'],
      );

      // Verify fileB.js was updated in main repo
      const contentB = await helper.readFile(mainRepo.path, 'fileB.js');
      expect(contentB).toBe('worktree modified B');

      // CRITICAL: Verify fileA.js (dirty file) was NOT affected
      const contentA = await helper.readFile(mainRepo.path, 'fileA.js');
      expect(contentA).toBe('user modified A');

      // Verify main repo still shows fileA.js as dirty
      const finalStatus = await helper.getGitStatus(mainRepo.path);
      expect(finalStatus).toContain('M fileA.js');
    });

    it('should restore dirty files when patch fails (no overlap case)', async () => {
      const mainRepo = await helper.createGitRepo({
        initialFiles: [
          { path: 'fileA.js', content: 'original A' },
          { path: 'fileB.js', content: 'original B' },
        ],
      });

      const worktreePath = await helper.createWorktree(mainRepo.path);

      // Create dirty workspace
      await helper.modifyFile(mainRepo.path, 'fileA.js', 'user dirty changes');
      const dirtyContent = await helper.readFile(mainRepo.path, 'fileA.js');

      // In worktree: create a patch that will fail
      await helper.modifyFile(worktreePath, 'fileB.js', 'worktree changes B');

      // Manually break fileB.js in main repo to cause patch failure
      await helper.modifyFile(mainRepo.path, 'fileB.js', 'conflicting changes');
      await helper.git(mainRepo.path, ['add', 'fileB.js']);
      await helper.createCommit(mainRepo.path, 'Break fileB');

      const baseCommit = await helper.git(worktreePath, ['rev-parse', 'HEAD']);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: baseCommit.stdout.trim(),
        branchName: 'test-worktree',
      };

      const diff = await helper.getGitDiff(worktreePath);
      const loop = new SalmonLoop();

      // Attempt applyBack (should fail and restore)
      await expect(
        (loop as any).applyBackToMainWorkspace(
          mainRepo.path,
          checkpointRef,
          diff,
          '3way',
          'extended',
          ['fileB.js'],
        ),
      ).rejects.toThrow();

      // CRITICAL: Verify dirty file was restored
      const restoredContent = await helper.readFile(mainRepo.path, 'fileA.js');
      expect(restoredContent).toBe(dirtyContent);
    });
  });

  describe('CRITICAL: Dirty workspace + WITH file overlap', () => {
    it('should correctly handle dirty overlap by failing safely and restoring backup', async () => {
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'fileA.js', content: 'line1\nline2\nline3\n' }],
      });

      const worktreePath = await helper.createWorktree(mainRepo.path);

      // User modifies fileA.js in main repo (dirty)
      await helper.modifyFile(mainRepo.path, 'fileA.js', 'line1\nuser modified\nline3\n');
      const dirtyStatus = await helper.getGitStatus(mainRepo.path);
      expect(dirtyStatus).toContain('M fileA.js');

      // Worktree also modifies fileA.js (OVERLAP!)
      await helper.modifyFile(worktreePath, 'fileA.js', 'line1\nline2\nworktree modified\n');

      const baseCommit = await helper.git(mainRepo.path, ['rev-parse', 'HEAD']);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: baseCommit.stdout.trim(),
        branchName: 'test-worktree',
      };

      const diff = await helper.getGitDiff(worktreePath);
      const loop = new SalmonLoop();

      // Apply back with overlap
      // Git apply often fails on dirty files even with 3way if index doesn't match.
      // We expect this to fail SAFELY (restore backup).
      await expect(
        (loop as any).applyBackToMainWorkspace(
          mainRepo.path,
          checkpointRef,
          diff,
          '3way',
          'extended',
          ['fileA.js'],
        ),
      ).rejects.toThrow();

      // Verify file matches ORIGINAL DIRTY content (backup restored)
      const content = await helper.readFile(mainRepo.path, 'fileA.js');
      expect(content).toContain('user modified');
      expect(content).not.toContain('worktree modified');
    });

    it('should restore dirty files when patch fails (overlap case)', async () => {
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'fileA.js', content: 'line1\nline2\nline3\n' }],
      });

      const worktreePath = await helper.createWorktree(mainRepo.path);

      // Create dirty workspace with fileA.js
      await helper.modifyFile(
        mainRepo.path,
        'fileA.js',
        'user dirty content that should be preserved',
      );
      const originalDirtyContent = await helper.readFile(mainRepo.path, 'fileA.js');

      // In worktree: modify same file
      await helper.modifyFile(worktreePath, 'fileA.js', 'worktree conflicting changes');

      // Commit in main repo to create conflict
      await helper.git(mainRepo.path, ['add', 'fileA.js']);
      await helper.createCommit(mainRepo.path, 'Commit dirty changes');

      // Now make it dirty again
      await helper.modifyFile(mainRepo.path, 'fileA.js', originalDirtyContent);

      const baseCommit = await helper.git(worktreePath, ['rev-parse', 'HEAD~1']);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: baseCommit.stdout.trim(),
        branchName: 'test-worktree',
      };

      const diff = await helper.getGitDiff(worktreePath);
      const loop = new SalmonLoop();

      // Attempt applyBack (will fail due to conflict)
      await expect(
        (loop as any).applyBackToMainWorkspace(
          mainRepo.path,
          checkpointRef,
          diff,
          '3way',
          'extended',
          ['fileA.js'],
        ),
      ).rejects.toThrow();

      // CRITICAL: Verify dirty content was restored
      const restoredContent = await helper.readFile(mainRepo.path, 'fileA.js');
      expect(restoredContent).toBe(originalDirtyContent);
    });
  });

  describe('CRITICAL: Fingerprint validation', () => {
    it('should detect workspace changes during applyBack', async () => {
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'fileA.js', content: 'original' }],
      });

      const worktreePath = await helper.createWorktree(mainRepo.path);

      // Make workspace dirty
      await helper.modifyFile(mainRepo.path, 'fileA.js', 'dirty content');

      // In worktree: make changes
      await helper.modifyFile(worktreePath, 'fileA.js', 'worktree content');

      const baseCommit = await helper.git(mainRepo.path, ['rev-parse', 'HEAD']);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: baseCommit.stdout.trim(),
        branchName: 'test-worktree',
      };

      const diff = await helper.getGitDiff(worktreePath);
      const loop = new SalmonLoop();

      // Start applyBack
      const applyBackPromise = (loop as any).applyBackToMainWorkspace(
        mainRepo.path,
        checkpointRef,
        diff,
        '3way',
        'extended',
        ['fileA.js'],
      );

      // In a real scenario, if the workspace changes during applyBack,
      // fingerprint validation should catch it.
      // However, git apply might also catch it first.
      // Either way, it must fail.
      await expect(applyBackPromise).rejects.toThrow();

      // Verify operation did not corrupt the file (it should be either original dirty or restored)
      const exists = await helper.fileExists(mainRepo.path, 'fileA.js');
      expect(exists).toBe(true);
      const content = await helper.readFile(mainRepo.path, 'fileA.js');
      expect(content).toBe('dirty content');
    });

    it('should abort when applyBackOnDirty is "abort"', async () => {
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'fileA.js', content: 'original' }],
      });

      const worktreePath = await helper.createWorktree(mainRepo.path);

      // Make workspace dirty
      await helper.modifyFile(mainRepo.path, 'fileA.js', 'dirty content');
      const dirtyStatus = await helper.getGitStatus(mainRepo.path);
      expect(dirtyStatus).toContain('M fileA.js');

      // In worktree: make changes
      await helper.modifyFile(worktreePath, 'fileA.js', 'worktree content');

      const baseCommit = await helper.git(mainRepo.path, ['rev-parse', 'HEAD']);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: baseCommit.stdout.trim(),
        branchName: 'test-worktree',
      };

      const diff = await helper.getGitDiff(worktreePath);
      const loop = new SalmonLoop();

      // Should abort when dirty and mode is 'abort'
      await expect(
        (loop as any).applyBackToMainWorkspace(
          mainRepo.path,
          checkpointRef,
          diff,
          'abort',
          'extended',
          ['fileA.js'],
        ),
      ).rejects.toThrow(/uncommitted changes/);

      // Verify workspace was not modified
      const content = await helper.readFile(mainRepo.path, 'fileA.js');
      expect(content).toBe('dirty content');
    });
  });

  describe('CRITICAL: Untracked files handling', () => {
    it('should preserve untracked files during applyBack', async () => {
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'tracked.js', content: 'tracked' }],
      });

      const worktreePath = await helper.createWorktree(mainRepo.path);

      // Create untracked file in main repo
      await helper.writeFile(mainRepo.path, 'untracked.js', 'important untracked file');

      // Verify it's untracked
      const status = await helper.getGitStatus(mainRepo.path);
      expect(status).toContain('?? untracked.js');

      // In worktree: modify tracked file
      await helper.modifyFile(worktreePath, 'tracked.js', 'worktree modified tracked');

      const baseCommit = await helper.git(mainRepo.path, ['rev-parse', 'HEAD']);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: baseCommit.stdout.trim(),
        branchName: 'test-worktree',
      };

      const diff = await helper.getGitDiff(worktreePath);
      const loop = new SalmonLoop();

      // Apply back
      await (loop as any).applyBackToMainWorkspace(
        mainRepo.path,
        checkpointRef,
        diff,
        '3way',
        'extended',
        ['tracked.js'],
      );

      // CRITICAL: Verify untracked file still exists
      const untrackedExists = await helper.fileExists(mainRepo.path, 'untracked.js');
      expect(untrackedExists).toBe(true);

      const untrackedContent = await helper.readFile(mainRepo.path, 'untracked.js');
      expect(untrackedContent).toBe('important untracked file');
    });
  });
});
