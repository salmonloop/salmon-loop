import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

import { mkdir, rm } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { getLogger } from '../../observability/logger.js';
import { normalizePath } from '../../utils/path.js';

import { extractSafeSnapshotErrorSummary, hashRepoPathForAudit } from './snapshot-audit.js';
import { createSnapshotCommitFromStagedTree } from './snapshot-create.js';
import { probeWriteTreeFailure, tryWriteTreeWithRetry } from './snapshot-write-tree.js';

export interface SnapshotResult {
  commitHash: string;
  stagedTree: string;
}

export class CheckpointManager {
  private readonly writeTreeRetryDelaysMs = [30, 80];

  /**
   * Creates a safe snapshot of the current repository state (T0).
   * S8P Checkpoint Protocol v1.0
   *
   * Definition:
   * - T0 (Snapshot): The stable baseline state when the AI task begins.
   *
   * Features:
   * - Zero pollution: Does not modify the user's index or working tree.
   * - Precision: Separately captures staged and working tree states.
   * - Safety: Excludes ignored files (like node_modules) by default.
   */
  async createSafeSnapshot(
    repoPath: string,
    includePaths: string[] = [],
    message?: string,
  ): Promise<SnapshotResult> {
    let step:
      | 'write-tree'
      | 'read-tree'
      | 'add-u'
      | 'write-tree-final'
      | 'commit-tree'
      | 'update-ref'
      | undefined;
    // 1. Capture Staged State (read directly from user's real index)
    // git write-tree generates a tree object from the current index
    const git = new GitAdapter(repoPath);
    try {
      step = 'write-tree';
      const { tree: stagedTree } = await tryWriteTreeWithRetry(git, this.writeTreeRetryDelaysMs);

      const commitHash = await createSnapshotCommitFromStagedTree({
        git,
        stagedTree,
        includePaths,
        message,
        onStep: (currentStep) => {
          step = currentStep;
        },
      });

      // 9. Mount Reference (Persistence)
      // Use update-ref to prevent GC and allow easy lookup
      step = 'update-ref';
      await git.query([
        'update-ref',
        '-m',
        's8p-checkpoint',
        `refs/s8p/snapshots/${commitHash}`,
        commitHash,
      ]);

      return { commitHash, stagedTree };
    } catch (error) {
      if (
        step === 'write-tree' ||
        step === 'read-tree' ||
        step === 'add-u' ||
        step === 'write-tree-final' ||
        step === 'commit-tree'
      ) {
        let writeTreeProbe: Record<string, unknown> = {};
        if (step === 'write-tree') {
          try {
            writeTreeProbe = await probeWriteTreeFailure(git);
          } catch {
            writeTreeProbe = {};
          }
        }
        recordAuditEvent(
          'snapshot.create.step.failed',
          {
            step,
            repoPathHash: hashRepoPathForAudit(repoPath),
            includePathsCount: includePaths.length,
            ...extractSafeSnapshotErrorSummary(error),
            ...writeTreeProbe,
          },
          { source: 'runtime', severity: 'high', scope: 'session', phase: 'PREFLIGHT' },
        );
      }
      throw error;
    }
  }

  /**
   * Restores a snapshot to a shadow worktree.
   * CRITICAL: Never run this on the main repository!
   *
   * DESIGN INTENT (see docs/design/checkpoint.md):
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * This implements the "Source is Truth" principle by creating HIGH-FIDELITY replica:
   * - Staged changes (git add)
   * - Unstaged changes (modified but not staged)
   * - Untracked files (captured in snapshot)
   *
   * Why the "Dirty State" is INTENTIONAL (not a bug):
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Common Misunderstanding:
   * ❌ "Having Index ≠ Worktree means the system is inconsistent"
   * ✅ Correct: This is the FOUNDATION of 3-way merge semantics
   *
   * Design Philosophy:
   * This method intentionally preserves the "dirty state" to maintain staged/unstaged distinction:
   * - Working tree = snapshot's working tree (contains all changes including unstaged)
   * - Index = snapshot's staged tree (only staged changes)
   * - git status = unstaged changes (Working - Staged)
   *
   * Why This Matters for Apply-Back (docs/design/applyback.md):
   * When AI patches are applied, 3-way merge needs:
   *   Base: Original Staged State (from snapshot metadata)
   *   Theirs: User's concurrent changes (if any)
   *   Ours: AI-generated patches
   *
   * If we flattened (Index = Worktree), we LOSE staged/unstaged distinction,
   * breaking transactional semantics.
   *
   * This design is CORRECT and necessary for:
   * 1. Preserving user's original staged/unstaged state in worktree isolation
   * 2. Enabling 3-way merge to correctly incorporate user changes
   * 3. Supporting workflow where dirty data must be maintained across operations
   *
   * Post-Condition (Best-Effort):
   * - Git index is refreshed to reflect working tree state
   * - Subsequent fs.readFile operations should observe the latest working tree content
   * - Note: This is a best-effort guarantee, not a strict fsync operation
   */
  async restoreToShadow(repoPath: string, shadowPath: string, snapshotHash: string): Promise<void> {
    const git = new GitAdapter(repoPath);
    const shadowGit = new GitAdapter(shadowPath);
    // 1. Get Metadata
    const msg = await git.query(['log', '-1', '--format=%B', snapshotHash]);
    let meta: { staged: string };
    try {
      meta = JSON.parse(msg);
    } catch {
      throw new Error(`Invalid snapshot metadata for ${snapshotHash}`);
    }

    if (!meta.staged) {
      throw new Error(`Snapshot ${snapshotHash} missing staged tree info`);
    }

    getLogger().debug(`[restoreToShadow] Restoring snapshot ${snapshotHash} to shadow worktree`);
    getLogger().debug(`[restoreToShadow] Snapshot metadata - staged tree: ${meta.staged}`);

    // 2. Restore Working Tree
    // Force checkout the snapshot in the shadow worktree
    // This sets HEAD, Index, and Working Tree to the snapshot state (Dirty)
    await shadowGit.exec(['checkout', '-f', snapshotHash]);
    getLogger().debug(`[restoreToShadow] Step 1: Checked out snapshot to shadow worktree`);

    // 3. Reset HEAD to Original Parent
    // The snapshot commit is created with HEAD as parent.
    // We want the shadow worktree's HEAD to match the original repo's HEAD (Clean),
    // so that git diff shows the correct unstaged changes.
    const parent = await git.query(['rev-parse', `${snapshotHash}^`]);
    const parentTrimmed = parent.trim();
    await shadowGit.exec(['reset', '--soft', parentTrimmed]);
    getLogger().debug(`[restoreToShadow] Step 2: Reset HEAD to parent ${parentTrimmed}`);

    // 4. Restore Staged State
    // Read the staged tree into the shadow worktree's index
    // This ensures the Index matches the original Staged state.
    await shadowGit.query(['read-tree', meta.staged]);
    getLogger().debug(`[restoreToShadow] Step 3: Restored staged tree to index`);

    // At this point:
    // - Shadow Disk = Snapshot Working Tree (contains dirty data)
    // - Shadow Index = Snapshot Staged State (original staged tree)
    // - git status = Unstaged changes (Working - Staged)
    //
    // This design correctly preserves the original staged/unstaged state.

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CRITICAL: Filesystem Cache Synchronization
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Problem (especially on Windows):
    // After git operations, filesystem caches may contain stale data.
    // Subsequent fs.readFile() might read OLD content from before checkout.
    //
    // Solution:
    // 'git update-index --refresh' forces Git to stat() all tracked files,
    // updating its internal cache to match current filesystem state.
    //
    // Why NOT throw on error (defensive design):
    // - This is PERFORMANCE OPTIMIZATION, not correctness requirement
    // - System has FALLBACK: readSnapshotFile() reads from Git Object Database
    // - See docs/design/checkpoint.md L38-42: "reads directly from blob"
    // - Throwing would break execution for non-critical optimization failure
    //
    // Performance optimization: Use 'git update-index --refresh' instead of
    // 'git status' to avoid scanning untracked files in large repositories.
    // Then use 'status -uno' for logging without full untracked scan.
    try {
      // Refresh index entries for tracked files only (fast, no untracked scan)
      await shadowGit.query(['update-index', '-q', '--refresh']);
      getLogger().debug(`[restoreToShadow] Git index refreshed successfully`);

      // Get status for logging (skip untracked files for performance)
      const status = await shadowGit.query(['status', '--short', '-uno']);
      const headRef = await shadowGit.query(['rev-parse', 'HEAD']);

      getLogger().debug(
        `[restoreToShadow] Post-restore git status in ${shadowPath}:\n${status || '(clean)'}`,
      );
      getLogger().debug(`[restoreToShadow] Current HEAD: ${headRef.trim()}`);

      if (status.trim()) {
        getLogger().debug(
          `[restoreToShadow] Shadow worktree contains unstaged changes as expected. ` +
            `This preserves the original dirty state for 3-way merge.`,
        );
      }
    } catch (e) {
      // NOT a critical failure - system has fallback via Git Object Database
      getLogger().error(
        `[restoreToShadow] Failed to refresh index or verify status: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Intentionally NOT throwing - execution continues with ODB fallback
      // See readSnapshotFile() for the direct Git object database read path
    }
  }

  /**
   * Reads a file from a snapshot using Git object database.
   *
   * ARCHITECTURE OPTIMIZATION: This is the PREFERRED method for reading file content.
   *
   * Advantages:
   * 1. Avoids filesystem cache issues entirely (no Windows cache delays)
   * 2. Works with untracked files (captured in snapshot)
   * 3. Works with ignored files (if explicitly included via includePaths)
   * 4. Provides consistent cross-platform behavior
   * 5. Better performance (direct object read vs filesystem I/O)
   *
   * @param repoPath - Repository path (main or shadow worktree)
   * @param snapshotHash - Snapshot commit hash
   * @param filePath - Relative file path (will be normalized)
   * @returns File content as string, or null if file doesn't exist in snapshot
   */
  async readSnapshotFile(
    repoPath: string,
    snapshotHash: string,
    filePath: string,
  ): Promise<string | null> {
    try {
      const git = new GitAdapter(repoPath);
      const normalized = normalizePath(filePath);
      const content = await git.query(['show', `${snapshotHash}:${normalized}`]);
      return content;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Only return null if the file truly doesn't exist in the snapshot
      // Git messages:
      // - "fatal: Path '...' does not exist in '...'"
      // - "fatal: path '...' exists on disk, but not in '...'"
      if (
        msg.includes('does not exist') ||
        msg.includes('not in') ||
        msg.includes('invalid object name')
      ) {
        getLogger().debug(
          `[CheckpointManager] File ${filePath} not found in snapshot ${snapshotHash}`,
        );
        return null;
      }
      // Rethrow unexpected errors (e.g. git process crash, corruption) to avoid masking real issues
      throw error;
    }
  }

  /**
   * Exports a snapshot to a specific directory.
   * Uses git checkout-index to avoid creating a .git directory in the target.
   */
  async exportSnapshot(repoPath: string, snapshotHash: string, targetDir: string): Promise<void> {
    // Ensure target directory exists
    await mkdir(targetDir, { recursive: true });

    // Use a temporary index to avoid messing with the main repo index
    const random = randomBytes(4).toString('hex');
    const tempIndexFile = join(tmpdir(), `s8p-export-idx-${Date.now()}-${random}`);
    const env = { ...process.env, GIT_INDEX_FILE: tempIndexFile };

    try {
      // 1. Read snapshot tree into temporary index
      const git = new GitAdapter(repoPath);
      await git.exec(['read-tree', snapshotHash], { env });

      // 2. Checkout index to target directory
      // Note: checkout-index requires trailing slash in prefix to denote directory
      const normalizedTarget = normalizePath(targetDir);
      const prefix = normalizedTarget.endsWith('/') ? normalizedTarget : `${normalizedTarget}/`;

      await git.exec(['checkout-index', '-a', '--prefix', prefix], { env });
    } finally {
      // Cleanup temporary index
      try {
        await rm(tempIndexFile, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Restores a snapshot to the main repository.
   * WARNING: This is a destructive operation.
   */
  async restoreToMain(
    repoPath: string,
    snapshotHash: string,
    force: boolean = false,
  ): Promise<void> {
    const git = new GitAdapter(repoPath);
    // 1. Safety Check
    if (!force) {
      const status = await git.getStatus();
      if (status.trim()) {
        throw new Error('Workspace is dirty. Use --force to overwrite.');
      }
    }

    // 2. Get Metadata
    const msg = await git.query(['log', '-1', '--format=%B', snapshotHash]);
    let meta: { staged: string };
    try {
      meta = JSON.parse(msg);
    } catch {
      throw new Error(`Invalid snapshot metadata for ${snapshotHash}`);
    }

    // 3. Get Parent Commit (Original HEAD)
    // The snapshot commit is created with HEAD as parent
    const parent = await git.query(['rev-parse', `${snapshotHash}^`]);

    // 4. Restore HEAD (Soft Reset)
    // Move HEAD back to where it was when snapshot was taken
    await git.exec(['reset', '--soft', parent.trim()]);

    // 5. Cleanup AI mess before restoring snapshot
    await git.exec(['clean', '-fd', '-e', '.salmonloop']);

    // 6. Restore Working Tree
    // Checkout files from snapshot commit into working directory
    await git.exec(['checkout', snapshotHash, '--', '.']);

    // 7. Restore Index
    // Reset index to match the staged tree from metadata
    await git.query(['read-tree', meta.staged]);
  }

  /**
   * Lists all available snapshots.
   */
  async listSnapshots(
    repoPath: string,
    limit?: number,
  ): Promise<{ hash: string; timestamp: string; message: string; ref: string }[]> {
    try {
      const args = [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname) %(objectname:short) %(committerdate:iso) %(subject)',
      ];

      if (limit && limit > 0) {
        args.push(`--count=${limit}`);
      }

      args.push('refs/s8p/snapshots/');

      const git = new GitAdapter(repoPath);
      const output = await git.query(args);

      return output
        .split('\n')
        .filter((line: string) => line.trim())
        .map((line: string) => {
          // Format: refs/s8p/snapshots/<hash> <short-hash> <date> <subject>
          const parts = line.split(' ');
          const ref = parts[0];
          const hash = parts[1];
          const timestamp = parts.slice(2, 5).join(' ');
          const message = parts.slice(5).join(' ');
          return { hash, timestamp, message, ref };
        });
    } catch {
      return [];
    }
  }

  /**
   * Deletes a specific snapshot by its hash.
   * If the hash is short, it tries to find the full ref.
   */
  async deleteSnapshot(repoPath: string, snapshotHash: string): Promise<void> {
    const git = new GitAdapter(repoPath);
    // Try to delete directly first (assuming full hash matches ref name)
    try {
      await git.exec(['update-ref', '-d', `refs/s8p/snapshots/${snapshotHash}`]);
      return;
    } catch {
      // If direct deletion fails (maybe hash mismatch or short hash), try to find the ref
    }

    // Fallback: find the ref pointing to this hash
    // Note: This is expensive if there are many snapshots, but safe.
    // However, clearSnapshots should use the ref directly for performance.
    const snapshots = await this.listSnapshots(repoPath);
    const target = snapshots.find((s: any) => s.hash.startsWith(snapshotHash));
    if (target) {
      await git.exec(['update-ref', '-d', target.ref]);
    } else {
      // If we can't find it, maybe it's already gone.
      // We could throw, but idempotency is nice.
      getLogger().debug(`Could not find snapshot ref for hash ${snapshotHash} to delete.`);
    }
  }

  /**
   * Clears all snapshots.
   */
  async clearSnapshots(repoPath: string): Promise<void> {
    const git = new GitAdapter(repoPath);
    const snapshots = await this.listSnapshots(repoPath);
    for (const snapshot of snapshots) {
      // Use the full ref name directly for reliable deletion
      await git.exec(['update-ref', '-d', snapshot.ref]);
    }
  }

  /**
   * Gets details of a snapshot (staged vs unstaged files).
   */
  async getSnapshotDetails(
    repoPath: string,
    snapshotHash: string,
  ): Promise<{ stagedFiles: string[]; unstagedFiles: string[] }> {
    const git = new GitAdapter(repoPath);
    const msg = await git.query(['log', '-1', '--format=%B', snapshotHash]);
    let meta: { staged: string };
    try {
      meta = JSON.parse(msg);
    } catch {
      throw new Error(`Invalid snapshot metadata for ${snapshotHash}`);
    }

    // Staged files: Diff between Parent (HEAD at time of snapshot) and Staged Tree
    // Note: We use snapshot^ (Parent) as the base
    const stagedOutput = await git.query(['diff', '--name-only', `${snapshotHash}^`, meta.staged]);

    // Unstaged files: Diff between Staged Tree and Snapshot (Working Tree)
    const unstagedOutput = await git.query(['diff', '--name-only', meta.staged, snapshotHash]);

    return {
      stagedFiles: stagedOutput.split('\n').filter((f: string) => f.trim()),
      unstagedFiles: unstagedOutput.split('\n').filter((f: string) => f.trim()),
    };
  }

  /**
   * Gets the content of a file from a snapshot.
   */
  async getSnapshotFileContent(
    repoPath: string,
    snapshotHash: string,
    filePath: string,
  ): Promise<string> {
    const git = new GitAdapter(repoPath);
    return await git.query(['show', `${snapshotHash}:${filePath}`]);
  }

  /**
   * Gets the list of all files contained in a snapshot.
   */
  async getSnapshotFiles(repoPath: string, snapshotHash: string): Promise<string[]> {
    const git = new GitAdapter(repoPath);
    const output = await git.query(['ls-tree', '-r', '--name-only', snapshotHash]);
    return output.split('\n').filter((f: string) => f.trim());
  }

  /**
   * Gets the diff between a snapshot and the current workspace, or between two snapshots.
   */
  async getSnapshotDiff(
    repoPath: string,
    hash: string,
    otherHash?: string,
    codeMode: boolean = false,
  ): Promise<string> {
    const git = new GitAdapter(repoPath);
    const args = ['diff'];
    // If not in code mode, use --stat for summary.
    if (!codeMode) {
      args.push('--stat');
    }

    if (otherHash) {
      args.push(hash, otherHash);
    } else {
      args.push(hash); // Compares working tree (implicitly) with hash.
      // Note: "git diff hash" compares working tree with hash.
      // "git diff hash HEAD" compares hash with HEAD.
      // If we want "Current Workspace vs Snapshot", usually we want to see what changed SINCE snapshot.
      // git diff <snapshot>.. (working tree)
    }

    return await git.query(args);
  }

  /**
   * Creates a lightweight dirty backup (T1) using git stash create.
   * This captures the exact state of Index and Worktree at the moment of call (Pre-Apply).
   *
   * Definition:
   * - T1 (Dirty Backup): The user's workspace state just before AI changes are applied.
   *   This captures any user edits made between T0 and T1.
   *
   * Returns a stash commit hash or null if workspace is clean.
   */
  async createDirtyBackup(repoPath: string): Promise<string | null> {
    const git = new GitAdapter(repoPath);
    const status = await git.query(['status', '--porcelain']);
    if (!status.trim()) return null;

    // Use the robust snapshot mechanism instead of 'stash create' to ensure
    // that complex states like "AD" (Added in index, Deleted in worktree)
    // are correctly captured.
    const snapshot = await this.createSafeSnapshot(repoPath, [], 'T1 Dirty Backup');
    return snapshot.commitHash;
  }

  /**
   * Restores a dirty backup (T1).
   */
  async restoreDirtyBackup(repoPath: string, backupHash: string): Promise<void> {
    const git = new GitAdapter(repoPath);

    getLogger().debug(`[CheckpointManager] Restoring dirty backup T1: ${backupHash}`);

    // 1. Get Metadata (stored by createSafeSnapshot)
    const msg = await git.query(['log', '-1', '--format=%B', backupHash]);
    let meta: { staged: string };
    try {
      meta = JSON.parse(msg);
    } catch {
      throw new Error(`Invalid backup metadata for ${backupHash}`);
    }

    // 2. Restore Worktree and Index to the T1 state
    // We use read-tree --reset -u to ensure the worktree matches the backup commit exactly,
    // which correctly restores deleted files.
    await git.exec(['read-tree', '--reset', '-u', backupHash]);

    // 3. Restore the original Staged state
    // This resets the index to match the user's original staged changes.
    await git.exec(['read-tree', meta.staged]);

    // 4. Update stat cache so 'git status' is immediately accurate.
    await git.exec(['update-index', '--refresh'], { allowError: true });
  }
}
