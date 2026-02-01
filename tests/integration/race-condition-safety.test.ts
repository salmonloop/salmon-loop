/**
 * Race Condition Safety Tests - DYNAMIC Safety Gate
 *
 * CRITICAL: Tests the safety guarantees when user modifies files concurrently with AI execution.
 *
 * Scenarios:
 * 1. "Mid-Flight Modification": User edits file after AI starts but before AI finishes.
 * 2. "Conflict Detection": User edits conflict with AI edits.
 * 3. "Atomic Deletion Race": User modifies file while AI tries to delete it.
 *
 * Principle: Optimistic Concurrency Control (OCC)
 * Base = Snapshot (T0)
 * Ours = Current Worktree (T_now)
 * Theirs = AI Result (T_ai)
 */

import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../src/core/strata/runtime/synchronizer.js';
import type { CheckpointRef } from '../../src/core/types.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Race Condition Safety - DYNAMIC TIME DIMENSION', () => {
  const helper = new RealFsTestHelper();
  const checkpoints = new CheckpointManager();

  afterEach(async () => {
    await helper.cleanup();
  });

  describe('Scenario 1: Mid-Flight Modification (Non-Conflicting)', () => {
    it('should successfully merge when user adds content during AI thinking time', async () => {
      // Setup: Initial state (T0)
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'target.js', content: 'function main() {\n  // TODO\n}' }],
      });
      const worktreePath = await helper.createWorktree(mainRepo.path);

      // 1. Snapshot T0 (AI starts "thinking")
      // Use real CheckpointManager to create T0, ensuring integration fidelity
      const snapshot = await checkpoints.createSafeSnapshot(mainRepo.path);
      const snapshotT0 = snapshot.commitHash;

      // 2. User Action: Modify file on disk (T_now) - simulating user typing
      // User adds a comment at the top
      const userContent = '// User Header\nfunction main() {\n  // TODO\n}';
      await helper.modifyFile(mainRepo.path, 'target.js', userContent);

      // 3. AI Action: AI generates code based on T0
      // AI implements the function body
      // NOTE: AI sees T0, so it doesn't see "User Header"
      const aiContent = 'function main() {\n  console.log("Hello AI");\n}';
      // In Shadow Worktree, we apply AI change relative to T0
      // To simulate this in test, we just put aiContent directly or apply patch to T0
      // Here we simulate the Shadow Side: AI produces a commit based on T0
      // Reset worktree to T0 to apply AI change (simulating shadow env)
      await helper.git(worktreePath, ['reset', '--hard', snapshotT0]);
      await helper.modifyFile(worktreePath, 'target.js', aiContent);
      await helper.git(worktreePath, ['commit', '-am', 'AI generates code']);
      const snapshotTAI = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

      // 4. Merge Action: Apply AI result back to Main Repo
      const synchronizer = new WorkspaceSynchronizer(checkpoints);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: snapshotT0,
        branchName: 'shadow-branch',
      };

      // Get diff from Shadow (T0 -> T_AI)
      // Note: helper.getGitDiff only supports boolean for staged, so we use raw git command
      const { stdout: diff } = await helper.git(worktreePath, ['diff', snapshotT0, 'HEAD']);

      // Execute Apply
      // Expected: Merge (T0, T_now, T_AI)
      // NOTE: '3way' here is the `applyBackOnDirty` safety policy (allow dirty + backup).
      // It is NOT the merge strategy. The engine (ExplicitMerge vs AtomicPatch) is selected
      // dynamically by Smart Routing based on the nature of changes (text vs topology).
      await synchronizer.applyBackToMainWorkspace(
        mainRepo.path,
        checkpointRef,
        diff,
        '3way',
        'extended',
        ['target.js'],
        snapshotT0,
        snapshotTAI,
      );

      // 5. Verification
      const finalContent = await helper.readFile(mainRepo.path, 'target.js');

      // Expect: User's Header + AI's Body
      expect(finalContent).toContain('// User Header');
      expect(finalContent).toContain('console.log("Hello AI")');
      // Should NOT have conflict markers
      expect(finalContent).not.toContain('<<<<<<<');
    });
  });

  describe('Scenario 2: Conflict Detection', () => {
    it('should successfully merge (with markers) when user edits conflict with AI edits', async () => {
      // Setup: Initial state (T0)
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'config.json', content: '{"timeout": 1000}' }],
      });
      const worktreePath = await helper.createWorktree(mainRepo.path);

      const snapshot = await checkpoints.createSafeSnapshot(mainRepo.path);
      const snapshotT0 = snapshot.commitHash;

      // 2. User Action: Change timeout to 5000 (T_now)
      await helper.modifyFile(mainRepo.path, 'config.json', '{"timeout": 5000}');
      // const userContent = await helper.readFile(mainRepo.path, 'config.json');

      // 3. AI Action: Change timeout to 2000 (Based on T0)
      await helper.git(worktreePath, ['reset', '--hard', snapshotT0]);
      await helper.modifyFile(worktreePath, 'config.json', '{"timeout": 2000}');
      await helper.git(worktreePath, ['commit', '-am', 'AI optimization']);
      const snapshotTAI = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

      // 4. Merge Action
      const synchronizer = new WorkspaceSynchronizer(checkpoints);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: snapshotT0,
        branchName: 'shadow-branch',
      };
      const { stdout: diff } = await helper.git(worktreePath, ['diff', snapshotT0, 'HEAD']);

      // Execute Apply - Should Succeed (with markers) because ExplicitMerge handles content conflicts gracefully
      await synchronizer.applyBackToMainWorkspace(
        mainRepo.path,
        checkpointRef,
        diff,
        '3way', // Safety Policy: Allow dirty workspace
        'extended',
        ['config.json'],
        snapshotT0,
        snapshotTAI,
      );

      // 5. CRITICAL Verification: Markers present
      // The user content AND AI content should be present in markers.
      const finalContent = await helper.readFile(mainRepo.path, 'config.json');
      expect(finalContent).toContain('<<<<<<<');
      expect(finalContent).toContain('"timeout": 5000'); // User
      expect(finalContent).toContain('"timeout": 2000'); // AI
    });
  });

  describe('Scenario 3: Atomic Deletion Race', () => {
    it('should prevent AI from deleting a file that user just modified', async () => {
      // Setup
      const mainRepo = await helper.createGitRepo({
        initialFiles: [{ path: 'temp.log', content: 'log entry 1' }],
      });
      const worktreePath = await helper.createWorktree(mainRepo.path);

      const snapshot = await checkpoints.createSafeSnapshot(mainRepo.path);
      const snapshotT0 = snapshot.commitHash;

      // 2. User Action: Append important log (T_now)
      await helper.modifyFile(mainRepo.path, 'temp.log', 'log entry 1\nIMPORTANT DATA');
      const userContent = await helper.readFile(mainRepo.path, 'temp.log');

      // 3. AI Action: Delete the file (Based on T0, thinking it's just temp logs)
      await helper.git(worktreePath, ['reset', '--hard', snapshotT0]);
      await helper.git(worktreePath, ['rm', 'temp.log']);
      await helper.git(worktreePath, ['commit', '-m', 'Cleanup logs']);
      const snapshotTAI = (await helper.git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

      // 4. Merge Action
      const synchronizer = new WorkspaceSynchronizer(checkpoints);
      const checkpointRef: CheckpointRef = {
        strategy: 'worktree',
        repoPath: mainRepo.path,
        worktreePath,
        baseRef: snapshotT0,
        branchName: 'shadow-branch',
      };
      const { stdout: diff } = await helper.git(worktreePath, ['diff', snapshotT0, 'HEAD']);

      // Execute Apply - Should Fail or Conflict
      // Git merge-file behavior on modify/delete conflict:
      // It usually results in CONFLICT (modify/delete)
      await expect(
        synchronizer.applyBackToMainWorkspace(
          mainRepo.path,
          checkpointRef,
          diff,
          '3way',
          'extended',
          ['temp.log'],
          snapshotT0,
          snapshotTAI,
        ),
      ).rejects.toThrow();

      // 5. Verification: File should still exist with USER content
      const exists = await helper.fileExists(mainRepo.path, 'temp.log');
      expect(exists).toBe(true);
      const finalContent = await helper.readFile(mainRepo.path, 'temp.log');
      expect(finalContent).toBe(userContent);
    });
  });
});
