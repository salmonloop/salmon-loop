import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runGit } from '../../src/core/checkpoint/worktree.js';
import * as git from '../../src/core/git.js';
import { SalmonLoop } from '../../src/core/loop.js';
import { monitor } from '../../src/core/monitor.js';
import type { CheckpointRef } from '../../src/core/types.js';

vi.mock('../../src/core/git.js', async () => {
  const actual = await vi.importActual('../../src/core/git.js');
  return {
    ...actual,
    applyPatch: vi.fn(),
    getGitStatus: vi.fn(),
  };
});

vi.mock('../../src/core/checkpoint/worktree.js', async () => {
  const actual = await vi.importActual('../../src/core/checkpoint/worktree.js');
  return {
    ...actual,
    runGit: vi.fn(),
  };
});

describe('ApplyBack Flow Integration Tests', () => {
  let loop: SalmonLoop;
  const mainRepoPath = '/fake/main/repo';
  const worktreePath = '/tmp/salmon-loop-wt/repo/12345';

  const mockCheckpointRef: CheckpointRef = {
    strategy: 'worktree',
    repoPath: mainRepoPath,
    worktreePath,
    baseRef: 'HEAD',
    branchName: 'salmonloop/wt/test',
  };

  beforeEach(() => {
    loop = new SalmonLoop();
    monitor.resetMetrics();
    vi.clearAllMocks();
    vi.mocked(git.getGitStatus).mockResolvedValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyBackToMainWorkspace', () => {
    it('should successfully apply patch and record metrics', async () => {
      // Mock git diff to return a patch with minimal delay
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'add') {
          return '';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'diff') {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      });

      // Access private method using type assertion
      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      await applyBack(mainRepoPath, mockCheckpointRef, '');

      // Verify monitoring was recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(1);
      expect(metrics.failures).toBe(0);
      expect(metrics.durations).toHaveLength(1);
      expect(metrics.durations[0]).toBeGreaterThanOrEqual(0);
    });

    it('should rollback on applyPatch failure', async () => {
      let revParseCalls = 0;
      vi.mocked(git.getGitStatus).mockResolvedValueOnce(' M other.js').mockResolvedValue('');
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'add') {
          return '';
        }
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'rev-parse' && args.includes('refs/stash')) {
          revParseCalls++;
          return revParseCalls === 1 ? '' : 'abc123';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'stash' && args[1] === 'push') {
          return 'Saved working directory';
        }
        if (args[0] === 'stash' && args[1] === 'list') {
          return 'abc123 stash@{0}';
        }
        if (args[0] === 'stash' && args[1] === 'apply') {
          return 'Restored working directory';
        }
        if (args[0] === 'stash' && args[1] === 'drop') {
          return 'Dropped stash';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockRejectedValue(new Error('Patch does not apply'));

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      await expect(applyBack(mainRepoPath, mockCheckpointRef, '')).rejects.toThrow(
        'Patch does not apply',
      );

      // Verify stash apply was called for rollback
      expect(runGit).toHaveBeenCalledWith(mainRepoPath, ['stash', 'apply', '--index', 'stash@{0}']);

      // Verify failure was recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(1);
      expect(metrics.failures).toBe(1);
    });

    it('should use dual-merge apply-back when shadow refs are provided', async () => {
      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);
      const dualMerge = vi.fn().mockResolvedValue(undefined);
      (loop as any).applyBackWithDualMerge = dualMerge;

      vi.mocked(git.getGitStatus).mockResolvedValue(' M dirty.js');

      await applyBack(
        mainRepoPath,
        mockCheckpointRef,
        '',
        'stash',
        undefined,
        undefined,
        'ref-initial',
        'ref-latest',
      );

      expect(dualMerge).toHaveBeenCalledWith(
        mainRepoPath,
        mockCheckpointRef.worktreePath,
        'ref-initial',
        'ref-latest',
        undefined,
      );
      expect(runGit).not.toHaveBeenCalled();
    });

    it('should handle stash apply failure gracefully', async () => {
      let revParseCalls = 0;
      vi.mocked(git.getGitStatus).mockResolvedValueOnce(' M other.js').mockResolvedValue('');
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'add') {
          return '';
        }
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'rev-parse' && args.includes('refs/stash')) {
          revParseCalls++;
          return revParseCalls === 1 ? '' : 'abc123';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'stash' && args[1] === 'push') {
          return 'Saved';
        }
        if (args[0] === 'stash' && args[1] === 'list') {
          return 'abc123 stash@{0}';
        }
        if (args[0] === 'stash' && args[1] === 'apply') {
          throw new Error('Stash apply failed - conflicts');
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockRejectedValue(new Error('Apply failed'));

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      await expect(applyBack(mainRepoPath, mockCheckpointRef, '')).rejects.toThrow('Apply failed');

      // Verify stash apply was attempted
      expect(runGit).toHaveBeenCalledWith(mainRepoPath, ['stash', 'apply', '--index', 'stash@{0}']);

      // Verify failure was still recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.failures).toBe(1);
    });

    it('should apply without stashing when workspace is clean', async () => {
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'add') {
          return '';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockResolvedValue(undefined);

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      // Should not throw even though no stash is needed
      await expect(applyBack(mainRepoPath, mockCheckpointRef, '')).resolves.toBeUndefined();

      // Verify success was recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.failures).toBe(0);
    });

    it('should track duration accurately', async () => {
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'add') {
          return '';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'diff') {
          // Simulate some delay
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash') {
          return '';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      await applyBack(mainRepoPath, mockCheckpointRef, '');

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.durations[0]).toBeGreaterThanOrEqual(10);
    });

    it('should record failure when stash drop also fails', async () => {
      let dropCalled = false;
      let revParseCalls = 0;
      vi.mocked(git.getGitStatus).mockResolvedValueOnce(' M other.js').mockResolvedValue('');
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'add') {
          return '';
        }
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'rev-parse' && args.includes('refs/stash')) {
          revParseCalls++;
          return revParseCalls === 1 ? '' : 'abc123';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'stash' && args[1] === 'push') {
          return 'Saved';
        }
        if (args[0] === 'stash' && args[1] === 'list') {
          return 'abc123 stash@{0}';
        }
        if (args[0] === 'stash' && args[1] === 'apply') {
          return 'Applied';
        }
        if (args[0] === 'stash' && args[1] === 'drop') {
          dropCalled = true;
          throw new Error('Drop also failed');
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockRejectedValue(new Error('Apply failed'));

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      await expect(applyBack(mainRepoPath, mockCheckpointRef, '')).rejects.toThrow('Apply failed');

      expect(dropCalled).toBe(true);

      // Verify failure was recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.failures).toBe(1);
    });
  });

  describe('Metrics Reporting', () => {
    it('should accumulate multiple applyBack operations', async () => {
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'diff') {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'stash') {
          return '';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      });

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      // Execute multiple times
      await applyBack(mainRepoPath, mockCheckpointRef, '');
      await applyBack(mainRepoPath, mockCheckpointRef, '');
      await applyBack(mainRepoPath, mockCheckpointRef, '');

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(3);
      expect(metrics.failures).toBe(0);
      expect(metrics.durations).toHaveLength(3);

      const avgDuration = monitor.getApplyBackAvgDuration();
      expect(avgDuration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate failure rate correctly', async () => {
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'rev-parse') {
          return 'head123';
        }
        if (args[0] === 'write-tree') {
          return 'tree123';
        }
        if (args[0] === 'ls-files') {
          return '';
        }
        if (args[0] === 'stash') {
          return '';
        }
        return '';
      });

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);

      // 2 successes
      vi.mocked(git.applyPatch).mockResolvedValue(undefined);
      await applyBack(mainRepoPath, mockCheckpointRef, '');
      await applyBack(mainRepoPath, mockCheckpointRef, '');

      // 1 failure
      vi.mocked(git.applyPatch).mockRejectedValue(new Error('Failed'));
      try {
        await applyBack(mainRepoPath, mockCheckpointRef, '');
      } catch {
        // Expected
      }

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(3);
      expect(metrics.failures).toBe(1);

      const failureRate = metrics.failures / metrics.attempts;
      expect(failureRate).toBeCloseTo(0.333, 2);
    });
  });
});
