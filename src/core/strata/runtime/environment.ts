import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { recordAuditEvent } from '../../audit-trail.js';
import { sanitizeError } from '../../llm/errors.js';
import { logger } from '../../logger.js';
import { migrateLegacyRuntime } from '../../runtime-paths.js';
import { CheckpointRef, ExecutionWorkspace, LoopEvent, LoopOptions } from '../../types.js';
import { KAOMOJI } from '../../ui/kaomoji.js';
import { CheckpointManager } from '../checkpoint/manager.js';
import { ShadowDriver } from '../layers/shadow-driver/shadow-driver.js';
import { WorkspaceManager } from '../layers/worktree.js';

/**
 * Manages the execution environment for SalmonLoop.
 * Orchestrates WorkspaceManager and CheckpointManager to prepare the runtime.
 */
export class RuntimeEnvironment {
  public workspace?: ExecutionWorkspace;
  public checkpointRef?: CheckpointRef;
  public readonly checkpointManager: CheckpointManager;

  public initialSnapshotHash?: string;
  private setupWorkPath?: string; // Tracks path for cleanup even if workspace setup fails

  constructor(
    private options: LoopOptions,
    private emit: (event: LoopEvent) => void,
  ) {
    this.checkpointManager = new CheckpointManager();
  }

  /**
   * Gets the active repository path where operations should be performed.
   *
   * ARCHITECTURAL ABSTRACTION LAYER (see docs/design/strata-system.md):
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * This is a CONTEXT-AWARE getter that returns different paths based on strategy:
   *
   * ┌──────────────────┬─────────────────────────────────────────────┐
   * │ Strategy         │ activeRepoPath Returns                      │
   * ├──────────────────┼─────────────────────────────────────────────┤
   * │ 'worktree'       │ /tmp/s8p-wt/repo/123456-abc (shadow)        │
   * │ 'direct'         │ /home/user/repo (main repository)           │
   * └──────────────────┴─────────────────────────────────────────────┘
   *
   * Common Misunderstanding:
   * ❌ "This dynamic behavior is a path confusion risk"
   * ✅ Correct: This is PROPER ABSTRACTION - callers work with "execution context"
   *
   * Design Intent:
   * Callers should NOT need to know WHERE they're executing, only WHAT to do.
   * - Reading files → Use activeRepoPath (works in shadow or main)
   * - Applying patches → Use activeRepoPath (isolated in shadow)
   * - Reverting to main → Use options.repoPath (explicit main reference)
   *
   * How to Choose the Right Path:
   * ┌────────────────────────────┬──────────────────────────────┐
   * │ Operation                  │ Use                          │
   * ├────────────────────────────┼──────────────────────────────┤
   * │ Execute in workspace       │ activeRepoPath               │
   * │ Create GitAdapter          │ activeRepoPath               │
   * │ Apply AI patches           │ activeRepoPath (isolated)    │
   * │ Read snapshot metadata     │ options.repoPath (source)    │
   * │ Apply-back to user         │ options.repoPath (target)    │
   * │ Create worktree            │ workspace.baseRepoPath       │
   * └────────────────────────────┴──────────────────────────────┘
   *
   * Type Safety Note:
   * TypeScript cannot distinguish MainRepoPath vs ShadowPath at type level
   * because both are string. This is acceptable because:
   * 1. Destructive operations are guarded by isShadowWorktreePath() runtime checks
   * 2. The workspace object carries strategy metadata for disambiguation
   * 3. Explicit fields (baseRepoPath) are available when needed
   *
   * See Also:
   * - docs/user/execution-safety.md: "APPLY mutates the active execution workspace"
   * - docs/design/strata-system.md: "Source is Truth" principle
   *
   * @returns The workspace path where execution should happen
   * @throws Error if workspace is not initialized
   */
  get activeRepoPath(): string {
    if (!this.workspace) {
      throw new Error(text.loop.workspaceInitFailed);
    }
    return this.workspace.workPath;
  }

  async setup(): Promise<void> {
    const { options, emit, checkpointManager } = this;
    const now = () => new Date();
    await migrateLegacyRuntime(options.repoPath);

    // 1. Create safe snapshot if using worktree strategy
    if (options.strategy === 'worktree') {
      try {
        const includePaths: string[] = [];
        if (options.file) {
          includePaths.push(options.file);
        }

        const snapshot = await checkpointManager.createSafeSnapshot(options.repoPath, includePaths);
        this.initialSnapshotHash = snapshot.commitHash;

        emit({
          type: 'snapshot.created',
          commitHash: this.initialSnapshotHash,
          timestamp: now(),
        });
      } catch (error) {
        const msg = `Failed to create snapshot: ${sanitizeError(error)}`;
        throw new Error(msg);
      }
    }

    // 2. Setup workspace
    try {
      this.workspace = await WorkspaceManager.setup(
        {
          instruction: options.instruction,
          verify: options.verify,
          repoPath: options.repoPath,
          file: options.file,
          selection: options.selection,
          dryRun: options.dryRun,
          verbose: options.verbose,
          strategy: options.strategy,
        },
        this.initialSnapshotHash,
        emit,
      );
      this.setupWorkPath = this.workspace.workPath;

      // 3. Restore staged state in shadow worktree
      if (this.workspace.strategy === 'worktree' && this.initialSnapshotHash) {
        await checkpointManager.restoreToShadow(
          options.repoPath,
          this.workspace.workPath,
          this.initialSnapshotHash,
        );

        // CRITICAL FIX: Force filesystem sync after restoreToShadow
        const git = new GitAdapter(this.workspace.workPath);
        await git.query(['status', '--short']);
      }

      // 4. Hydrate Environment (L2): Link dependencies
      // This MUST happen after workspace setup but before any execution
      if (this.workspace.strategy === 'worktree' && this.workspace.workPath !== options.repoPath) {
        try {
          await ShadowDriver.hydrate(options.repoPath, this.workspace.workPath);
        } catch (error) {
          // Log warning but don't fail hard - dependency linking is an optimization/convenience
          // If strict mode is required, this should be configured to throw
          const msg = sanitizeError(error);
          emit({
            type: 'log',
            level: 'warn',
            message: `Dependency linking failed: ${msg}`,
            timestamp: now(),
          });
        }
      }
    } catch (error) {
      const msg = sanitizeError(error);
      throw new Error(`${text.loop.workspaceInitFailed}: ${msg}`);
    }

    // 5. Capture worktree metadata if using worktree strategy
    if (options.strategy === 'worktree') {
      try {
        const git = new GitAdapter(options.repoPath);
        const baseRef = this.initialSnapshotHash || (await git.query(['rev-parse', 'HEAD']));
        this.checkpointRef = {
          strategy: 'worktree',
          repoPath: options.repoPath,
          worktreePath: this.workspace.workPath,
          baseRef,
          branchName: 'workspace',
        };
        emit({
          type: 'checkpoint.created',
          worktreePath: this.checkpointRef.worktreePath,
          baseRef: this.checkpointRef.baseRef,
          timestamp: now(),
        });
      } catch (error) {
        const msg = text.loop.worktreeMetadataFailed(sanitizeError(error));
        throw new Error(msg);
      }
    }
  }

  async teardown(): Promise<void> {
    const { emit } = this;
    const now = () => new Date();
    let checkpointCleanupOk = true;

    const shouldReportCleanup =
      this.options.strategy === 'worktree' &&
      (this.workspace?.strategy === 'worktree' || Boolean(this.setupWorkPath));
    const interrupted = Boolean(this.options.signal?.aborted);

    if (shouldReportCleanup) {
      emit({
        type: 'ui.status',
        action: 'set',
        face: KAOMOJI.cleanupWorking,
        label: text.ui.status.cleanup,
        timestamp: now(),
      });
      emit({
        type: 'log',
        level: 'info',
        message: text.resource.workspaceCleanupStarting,
        timestamp: now(),
      });
      recordAuditEvent(
        'workspace.cleanup.start',
        {
          strategy: this.options.strategy,
          workPath: this.workspace?.workPath ?? this.setupWorkPath,
        },
        { source: 'runtime', severity: 'low', phase: 'TEARDOWN' },
      );
    }

    try {
      if (this.initialSnapshotHash && this.options.strategy === 'worktree') {
        try {
          await this.checkpointManager.deleteSnapshot(
            this.options.repoPath,
            this.initialSnapshotHash,
          );
        } catch (error) {
          checkpointCleanupOk = false;
          logger.debug(
            `Failed to delete snapshot ref refs/s8p/snapshots/${this.initialSnapshotHash}: ${error}`,
          );
        }
      }

      // Cleanup workspace
      if (this.workspace) {
        // Handle edge case where setup failed midway and path might differ
        if (
          this.workspace.strategy === 'worktree' &&
          this.setupWorkPath &&
          this.setupWorkPath !== this.workspace.workPath
        ) {
          try {
            await WorkspaceManager.teardown(
              {
                baseRepoPath: this.workspace.baseRepoPath,
                workPath: this.setupWorkPath,
                strategy: 'worktree',
              },
              emit,
            );
          } catch (error) {
            checkpointCleanupOk = false;
            const msg = sanitizeError(error);
            emit({
              type: 'log',
              level: 'warn',
              message: `Extra worktree cleanup failed: ${msg}`,
              timestamp: now(),
            });
          }
        }

        try {
          await WorkspaceManager.teardown(this.workspace, emit);
        } catch (error) {
          checkpointCleanupOk = false;
          const msg = sanitizeError(error);
          emit({
            type: 'log',
            level: 'warn',
            message: `Workspace cleanup failed: ${msg}`,
            timestamp: now(),
          });
        }
      }
    } finally {
      if (shouldReportCleanup) {
        recordAuditEvent(
          'workspace.cleanup.finish',
          {
            ok: checkpointCleanupOk,
            strategy: this.options.strategy,
            workPath: this.workspace?.workPath ?? this.setupWorkPath,
          },
          {
            source: 'runtime',
            severity: checkpointCleanupOk ? 'low' : 'medium',
            phase: 'TEARDOWN',
          },
        );
        emit({
          type: 'log',
          level: 'info',
          message: text.resource.workspaceCleanupFinished,
          timestamp: now(),
        });
        if (this.checkpointRef) {
          emit({
            type: 'checkpoint.cleaned',
            ok: checkpointCleanupOk,
            timestamp: now(),
          });
        }
        if (!interrupted) {
          emit({
            type: 'ui.status',
            action: 'set',
            face: KAOMOJI.cleanupDone,
            ttlMs: 2000,
            timestamp: now(),
          });
        }
      }
    }
  }
}
