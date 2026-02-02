import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { CheckpointRef, ExecutionWorkspace, LoopEvent, LoopOptions } from '../../types.js';
import { CheckpointManager } from '../checkpoint/manager.js';
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
   * This is either the main repo path or the shadow worktree path.
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
          type: 'log',
          level: 'debug',
          message: `Created safe snapshot: ${this.initialSnapshotHash}`,
          timestamp: now(),
        });
      } catch (error) {
        const msg = `Failed to create snapshot: ${error instanceof Error ? error.message : String(error)}`;
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`${text.loop.workspaceInitFailed}: ${msg}`);
    }

    // 4. Capture worktree metadata if using worktree strategy
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
        const msg = text.loop.worktreeMetadataFailed(
          error instanceof Error ? error.message : String(error),
        );
        throw new Error(msg);
      }
    }
  }

  async teardown(): Promise<void> {
    const { emit } = this;
    const now = () => new Date();
    let checkpointCleanupOk = true;

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
          const msg = error instanceof Error ? error.message : String(error);
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
        const msg = error instanceof Error ? error.message : String(error);
        emit({
          type: 'log',
          level: 'warn',
          message: `Workspace cleanup failed: ${msg}`,
          timestamp: now(),
        });
      }
    }

    if (this.checkpointRef) {
      emit({
        type: 'checkpoint.cleaned',
        ok: checkpointCleanupOk,
        timestamp: now(),
      });
    }
  }
}
