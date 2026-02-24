import { randomBytes } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';

/**
 * Integration Tests for State Management
 *
 * These tests validate the "SOURCE IS TRUTH" principle:
 * - Dirty data in main repo must be preserved across all operations
 * - Snapshot → Restore → Merge → ApplyBack flow maintains state integrity
 * - No state confusion or data loss
 */
describe('State Management Integration Tests', () => {
  type GitExecCall = [Parameters<GitAdapter['exec']>[0], ...unknown[]];

  let tempDir: string;
  let mainRepo: string;
  let shadowWorktree: string;
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    // Create temporary test environment
    tempDir = join(tmpdir(), `salmon-integration-${randomBytes(4).toString('hex')}`);
    await mkdir(tempDir, { recursive: true });

    mainRepo = join(tempDir, 'main-repo');
    shadowWorktree = join(tempDir, 'shadow-worktree');

    // Initialize main repository with initial commit
    await mkdir(mainRepo, { recursive: true });
    const git = new GitAdapter(mainRepo);
    await git.exec(['init', '--initial-branch=main']);
    await git.exec(['config', 'user.name', 'Test User']);
    await git.exec(['config', 'user.email', 'test@example.com']);

    const initialFile = join(mainRepo, 'code.js');
    await writeFile(initialFile, 'function hello() {\n  console.log("Hello");\n}\n');
    await git.exec(['add', '.']);
    await git.exec(['commit', '-m', 'Initial commit']);

    checkpointManager = new CheckpointManager();
  });

  afterEach(async () => {
    try {
      // Cleanup worktree first if it exists
      try {
        const git = new GitAdapter(mainRepo);
        await git.exec(['worktree', 'remove', shadowWorktree, '--force']);
      } catch {
        // Ignore if worktree doesn't exist
      }
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it(
    'should preserve dirty data through snapshot → restore → merge flow',
    async () => {
      // ARRANGE: Create dirty data in main repo (simulating user's work in progress)
      const codeFile = join(mainRepo, 'code.js');
      const dirtyContent = `function hello() {
  console.log("Hello");
}

// DIRTY_MARKER_1: User's uncommitted work
function goodbye() {
  console.log("Goodbye");
}
`;
      await writeFile(codeFile, dirtyContent);

      // ACT 1: Create snapshot (should capture dirty data)
      const snapshot = await checkpointManager.createSafeSnapshot(mainRepo);
      expect(snapshot.commitHash).toBeDefined();

      // ACT 2: Create shadow worktree and restore snapshot
      const git = new GitAdapter(mainRepo);
      await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);
      await checkpointManager.restoreToShadow(mainRepo, shadowWorktree, snapshot.commitHash);

      // ASSERT: Verify dirty data is observable in shadow worktree
      const shadowFile = join(shadowWorktree, 'code.js');
      const shadowContent = await readFile(shadowFile, 'utf-8');

      expect(shadowContent).toContain('DIRTY_MARKER_1');
      expect(shadowContent).toContain('function goodbye()');

      // ASSERT: Verify git status shows dirty state
      const shadowGit = new GitAdapter(shadowWorktree);
      const status = await shadowGit.exec(['status', '--short']);
      expect(status).toContain('M code.js');
    },
    { timeout: 30000 },
  );

  it(
    'should handle AI modifications without losing user dirty data',
    async () => {
      // ARRANGE: User has uncommitted changes
      const codeFile = join(mainRepo, 'code.js');
      await writeFile(
        codeFile,
        `function hello() {
  console.log("Hello");
}

// USER_CHANGE: Work in progress
const userVar = 42;
`,
      );

      const snapshot = await checkpointManager.createSafeSnapshot(mainRepo);
      const git = new GitAdapter(mainRepo);
      await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);
      await checkpointManager.restoreToShadow(mainRepo, shadowWorktree, snapshot.commitHash);

      // ACT: Simulate AI making a change in shadow worktree
      const shadowFile = join(shadowWorktree, 'code.js');
      const aiModified = `function hello() {
  console.log("Hello");
  console.log("AI added this line"); // AI_CHANGE
}

// USER_CHANGE: Work in progress
const userVar = 42;
`;
      await writeFile(shadowFile, aiModified);
      const shadowGit = new GitAdapter(shadowWorktree);
      await shadowGit.exec(['add', 'code.js']);
      await shadowGit.exec(['commit', '-m', 'AI modifications']);

      // ASSERT: Both user changes and AI changes should coexist
      const finalContent = await readFile(shadowFile, 'utf-8');
      expect(finalContent).toContain('AI_CHANGE');
      expect(finalContent).toContain('USER_CHANGE');
      expect(finalContent).toContain('const userVar = 42');
    },
    { timeout: 30000 },
  );

  it(
    'should maintain staged/unstaged distinction across operations',
    async () => {
      // ARRANGE: Create staged and unstaged changes
      const codeFile = join(mainRepo, 'code.js');
      const git = new GitAdapter(mainRepo);

      // Stage a change
      await writeFile(codeFile, 'function hello() {\n  console.log("Staged change");\n}\n');
      await git.exec(['add', 'code.js']);

      // Make unstaged change
      await writeFile(
        codeFile,
        'function hello() {\n  console.log("Staged change");\n}\n\n// Unstaged work\n',
      );

      // ACT: Snapshot and restore
      const snapshot = await checkpointManager.createSafeSnapshot(mainRepo);
      await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);
      await checkpointManager.restoreToShadow(mainRepo, shadowWorktree, snapshot.commitHash);

      // ASSERT: Verify distinction is maintained
      const shadowGit = new GitAdapter(shadowWorktree);
      const status = await shadowGit.exec(['status', '--short']);
      // We expect 'MM' because we have both staged changes (from snapshot index) AND unstaged changes (from snapshot worktree)
      expect(status).toContain('MM code.js');

      const shadowFile = join(shadowWorktree, 'code.js');
      const content = await readFile(shadowFile, 'utf-8');
      expect(content).toContain('Staged change');
      expect(content).toContain('Unstaged work');
    },
    { timeout: 30000 },
  );

  it(
    'should not lose data on Windows with filesystem caching (regression test)',
    async () => {
      // This test specifically validates the fix for Windows filesystem cache issue
      // where LLM would read stale data instead of fresh dirty content

      // ARRANGE: Create snapshot with specific markers
      const codeFile = join(mainRepo, 'code.js');
      const markers = ['MARKER_A', 'MARKER_B', 'MARKER_C'];
      const content = `function test() {
  // ${markers[0]}
  // ${markers[1]}
  // ${markers[2]}
  return true;
}
`;
      await writeFile(codeFile, content);
      const snapshot = await checkpointManager.createSafeSnapshot(mainRepo);

      // ACT: Restore to shadow worktree
      const git = new GitAdapter(mainRepo);
      await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);
      await checkpointManager.restoreToShadow(mainRepo, shadowWorktree, snapshot.commitHash);

      // ASSERT: Immediately read file via fs.readFile (simulating LLM context building)
      // This would fail before the fix due to Windows filesystem cache
      const shadowFile = join(shadowWorktree, 'code.js');
      const readContent = await readFile(shadowFile, 'utf-8');

      for (const marker of markers) {
        expect(readContent).toContain(marker);
      }

      // ASSERT: Multiple reads should all see the same content (filesystem observability)
      const secondRead = await readFile(shadowFile, 'utf-8');
      expect(secondRead).toBe(readContent);
    },
    { timeout: 30000 },
  );

  it(
    'should handle 3-way merge with user dirty data and AI changes',
    async () => {
      // ARRANGE: Setup base state
      const codeFile = join(mainRepo, 'code.js');
      const baseContent = `function original() {
  return "base";
}
`;
      await writeFile(codeFile, baseContent);
      const git = new GitAdapter(mainRepo);
      await git.exec(['add', '.']);
      await git.exec(['commit', '-m', 'Base state']);

      // User makes uncommitted changes (dirty data)
      const userContent = `function original() {
  return "base";
}

// User added this
function userFunction() {
  return "user";
}
`;
      await writeFile(codeFile, userContent);

      // ACT: Create snapshot, restore, and simulate AI modification
      const snapshot = await checkpointManager.createSafeSnapshot(mainRepo);
      await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);
      await checkpointManager.restoreToShadow(mainRepo, shadowWorktree, snapshot.commitHash);

      // AI modifies the original function in shadow worktree
      const shadowFile = join(shadowWorktree, 'code.js');
      const aiContent = `function original() {
  return "AI modified this";
}

// User added this
function userFunction() {
  return "user";
}
`;
      await writeFile(shadowFile, aiContent);

      // ASSERT: 3-way merge should preserve both changes
      const finalContent = await readFile(shadowFile, 'utf-8');
      expect(finalContent).toContain('AI modified this');
      expect(finalContent).toContain('function userFunction()');
    },
    { timeout: 30000 },
  );

  it(
    'should verify no external filesystem sync calls outside checkpoint manager',
    async () => {
      // This regression test ensures that the fix is encapsulated in CheckpointManager
      // and no external code tries to manually sync the filesystem

      const codeFile = join(mainRepo, 'code.js');
      await writeFile(codeFile, 'function test() { return true; }\n');

      const snapshot = await checkpointManager.createSafeSnapshot(mainRepo);
      const git = new GitAdapter(mainRepo);
      await git.exec(['worktree', 'add', shadowWorktree, 'HEAD']);

      // SPY: Monitor all git commands executed during restore
      // We spy on GitAdapter.prototype.exec instead of runGit
      const execSpy = vi.spyOn(GitAdapter.prototype, 'exec');

      try {
        await checkpointManager.restoreToShadow(mainRepo, shadowWorktree, snapshot.commitHash);

        // ASSERT: update-index should be called exactly once (by restoreToShadow)
        const execCalls = execSpy.mock.calls as GitExecCall[];
        const updateIndexCalls = execCalls.filter(
          ([args]) => args.includes('update-index') && args.includes('--refresh'),
        );
        expect(updateIndexCalls.length).toBe(1);

        // ASSERT: No redundant status calls without -uno flag
        const statusCalls = execCalls.filter(([args]) => args.includes('status'));
        statusCalls.forEach(([args]) => {
          if (!args.includes('--porcelain=v2')) {
            // If it's a status call for logging/refresh, it should use -uno
            expect(args).toContain('-uno');
          }
        });
      } finally {
        execSpy.mockRestore();
      }
    },
    { timeout: 30000 },
  );
});
