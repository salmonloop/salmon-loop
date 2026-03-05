import { createHash } from 'crypto';

import { text } from '../../../locales/index.js';
import { stat } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { GitSnapshotCheckpointService } from '../../checkpoint-domain/service.js';
import { LIMITS } from '../../config/limits.js';
import { sanitizeError } from '../../llm/errors.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { getLogger } from '../../observability/logger.js';
import { migrateLegacyRuntime } from '../../runtime/paths.js';
import { CheckpointRef, ExecutionWorkspace, LoopEvent, LoopOptions } from '../../types/index.js';
import { KAOMOJI } from '../../ui/kaomoji.js';
import { CheckpointManager } from '../checkpoint/manager.js';
import { ShadowDriver } from '../layers/shadow-driver/shadow-driver.js';
import { WorkspaceManager } from '../layers/worktree.js';

type ErrorWithCode = Error & {
  code?: string;
  cause?: unknown;
  safeMeta?: Record<string, unknown>;
};

function hashRepoPath(repoPath: string): string {
  return createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function asPreflightError(
  code: string,
  message: string,
  cause?: unknown,
  safeMeta?: Record<string, unknown>,
): ErrorWithCode {
  const inheritedCode =
    cause && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string'
      ? ((cause as { code: string }).code as string)
      : undefined;
  const finalCode = inheritedCode?.startsWith('PREFLIGHT_') ? inheritedCode : code;
  const error = new Error(message) as ErrorWithCode;
  error.code = finalCode;
  if (cause !== undefined) {
    error.cause = cause;
  }
  if (safeMeta) {
    error.safeMeta = safeMeta;
  }
  return error;
}

/**
 * Manages the execution environment for SalmonLoop.
 * Orchestrates WorkspaceManager and CheckpointManager to prepare the runtime.
 */
export class RuntimeEnvironment {
  public workspace?: ExecutionWorkspace;
  public checkpointRef?: CheckpointRef;
  public readonly checkpointManager: CheckpointManager;
  public readonly checkpointService: GitSnapshotCheckpointService;

  public initialSnapshotHash?: string;
  private setupWorkPath?: string; // Tracks path for cleanup even if workspace setup fails

  constructor(
    private options: LoopOptions,
    private emit: (event: LoopEvent) => void,
  ) {
    this.checkpointManager = new CheckpointManager();
    this.checkpointService = new GitSnapshotCheckpointService(this.checkpointManager);
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
      throw asPreflightError('PREFLIGHT_WORKSPACE_UNINITIALIZED', text.loop.workspaceInitFailed);
    }
    return this.workspace.workPath;
  }

  async setup(): Promise<void> {
    const { options, emit, checkpointManager } = this;
    const now = () => new Date();
    try {
      await migrateLegacyRuntime(options.repoPath);
    } catch (error) {
      const msg = `Failed to migrate runtime state: ${sanitizeError(error)}`;
      throw asPreflightError('PREFLIGHT_RUNTIME_MIGRATION_FAILED', msg, error);
    }

    // 1. Create safe snapshot if using worktree strategy
    if (options.strategy === 'worktree') {
      const includePaths: string[] = [];
      if (options.file) {
        includePaths.push(options.file);
      }
      try {
        const snapshot = await this.checkpointService.create({
          repoPath: options.repoPath,
          strategy: 'worktree',
          includePaths,
          sessionId: options.checkpointSessionId,
        });
        this.initialSnapshotHash = snapshot.id;

        emit({
          type: 'snapshot.created',
          commitHash: this.initialSnapshotHash,
          timestamp: now(),
        });
      } catch (error) {
        const repoExists = await pathExists(options.repoPath);
        let gitAvailable: boolean | 'unknown' = 'unknown';
        let gitProbeErrorCode: string | undefined;
        let gitProbeErrorName: string | undefined;
        try {
          const gitProbe = await new GitAdapter(options.repoPath).execMeta(
            ['rev-parse', '--is-inside-work-tree'],
            {
              cwd: options.repoPath,
              limits: { maxStdoutBytes: 4_096, maxStderrChars: 4_096 },
              timeoutMs: LIMITS.gitTimeoutMs,
            },
          );
          if (gitProbe.ok) {
            gitAvailable = true;
          } else if (gitProbe.error?.code === 'ENOENT') {
            gitAvailable = false;
          }
        } catch (probeError) {
          if (probeError && typeof probeError === 'object') {
            if (typeof (probeError as { code?: unknown }).code === 'string') {
              gitProbeErrorCode = (probeError as { code: string }).code;
            }
            if (typeof (probeError as { name?: unknown }).name === 'string') {
              gitProbeErrorName = (probeError as { name: string }).name;
            }
          }
          // Keep unknown when probe itself fails.
        }
        const safeMeta = {
          strategy: options.strategy ?? 'local',
          worktreeEnabled: options.strategy === 'worktree',
          repoPathHash: hashRepoPath(options.repoPath),
          repoExists,
          gitAvailable,
          gitProbeErrorCode,
          gitProbeErrorName,
          includePathsCount: includePaths.length,
        };
        recordAuditEvent('snapshot.create.failed', safeMeta, {
          source: 'runtime',
          severity: 'high',
          scope: 'session',
          phase: 'PREFLIGHT',
        });
        const msg = `Failed to create snapshot: ${sanitizeError(error)}`;
        throw asPreflightError('PREFLIGHT_SNAPSHOT_FAILED', msg, error, safeMeta);
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
          environmentMode: options.environmentMode,
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
      throw asPreflightError(
        'PREFLIGHT_WORKSPACE_INIT_FAILED',
        `${text.loop.workspaceInitFailed}: ${msg}`,
        error,
      );
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
        throw asPreflightError('PREFLIGHT_WORKTREE_METADATA_FAILED', msg, error);
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
          getLogger().debug(
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
