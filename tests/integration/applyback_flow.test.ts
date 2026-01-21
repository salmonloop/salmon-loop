import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SalmonLoop } from '../../src/core/loop.js';
import type { CheckpointRef } from '../../src/core/types.js';
import { monitor } from '../../src/core/monitor.js';
import * as git from '../../src/core/git.js';
import { runGit } from '../../src/core/checkpoint/worktree.js';

vi.mock('../../src/core/git.js', async () => {
  const actual = await vi.importActual('../../src/core/git.js');
  return {
    ...actual,
    applyPatch: vi.fn(),
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyBackToMainWorkspace', () => {
    it('should successfully apply patch and record metrics', async () => {
      // Mock git diff to return a patch with minimal delay
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'diff') {
          await new Promise(resolve => setTimeout(resolve, 1));
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash') {
          return ''; // Stash success
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
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
      let gitCallCount = 0;
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        gitCallCount++;
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash' && args[1] === 'save') {
          return 'Saved working directory';
        }
        if (args[0] === 'stash' && args[1] === 'pop') {
          return 'Restored working directory';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockRejectedValue(new Error('Patch does not apply'));

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);
      
      await expect(applyBack(mainRepoPath, mockCheckpointRef, '')).rejects.toThrow('Patch does not apply');

      // Verify stash pop was called for rollback
      expect(runGit).toHaveBeenCalledWith(mainRepoPath, ['stash', 'pop']);

      // Verify failure was recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(1);
      expect(metrics.failures).toBe(1);
    });

    it('should handle stash pop failure gracefully', async () => {
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash' && args[1] === 'save') {
          return 'Saved';
        }
        if (args[0] === 'stash' && args[1] === 'pop') {
          throw new Error('Stash pop failed - conflicts');
        }
        if (args[0] === 'stash' && args[1] === 'drop') {
          return 'Dropped stash';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockRejectedValue(new Error('Apply failed'));

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);
      
      await expect(applyBack(mainRepoPath, mockCheckpointRef, '')).rejects.toThrow('Apply failed');

      // Verify stash drop was called as fallback
      expect(runGit).toHaveBeenCalledWith(mainRepoPath, ['stash', 'drop']);

      // Verify failure was still recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.failures).toBe(1);
    });

    it('should continue when stash creation fails (nothing to stash)', async () => {
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash' && args[1] === 'save') {
          throw new Error('No local changes to save');
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockResolvedValue(undefined);

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);
      
      // Should not throw even though stash failed
      await expect(applyBack(mainRepoPath, mockCheckpointRef, '')).resolves.toBeUndefined();

      // Verify success was recorded
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.failures).toBe(0);
    });

    it('should track duration accurately', async () => {
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'diff') {
          // Simulate some delay
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash') {
          return '';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const applyBack = (loop as any).applyBackToMainWorkspace.bind(loop);
      
      await applyBack(mainRepoPath, mockCheckpointRef, '');

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.durations[0]).toBeGreaterThanOrEqual(10);
    });

    it('should record failure when stash drop also fails', async () => {
      let dropCalled = false;
      vi.mocked(runGit).mockImplementation(async (repoPath, args) => {
        if (args[0] === 'diff') {
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash' && args[1] === 'save') {
          return 'Saved';
        }
        if (args[0] === 'stash' && args[1] === 'pop') {
          throw new Error('Pop failed');
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
          await new Promise(resolve => setTimeout(resolve, 1));
          return 'diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1 +1 @@\n-old\n+new';
        }
        if (args[0] === 'stash') {
          return '';
        }
        return '';
      });

      vi.mocked(git.applyPatch).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
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
