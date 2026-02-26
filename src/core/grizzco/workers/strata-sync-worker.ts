import { promises as fs } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { CheckpointManager } from '../../strata/checkpoint/manager.js';
import { ShadowMergeEngine } from '../../strata/engine/shadow-merge-engine.js';
import { FileState, MergeResult, ShadowOperation } from '../domain/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * StrataSyncWorker
 * A bridge worker that delegates to the legacy ShadowMergeEngine for complex worktree synchronizations.
 */
export class StrataSyncWorker implements IMergeWorker {
  readonly id = 'strata-sync';

  constructor(
    private git: GitAdapter,
    private checkpoints: CheckpointManager,
  ) {}

  async execute(
    op: ShadowOperation,
    state: FileState,
    context?: {
      snapshotId?: string;
      shadowWorktreePath?: string;
      initialRef?: string;
      latestRef?: string;
    },
  ): Promise<MergeResult> {
    const startTime = Date.now();

    // Guard: Ensure we have necessary context for ShadowMergeEngine
    if (!context?.shadowWorktreePath || !context?.initialRef || !context?.latestRef) {
      return {
        path: state.path,
        success: false,
        error: 'StrataSyncWorker requires shadowWorktreePath, initialRef, and latestRef in context',
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // 1. Instantiate the legacy engine
      const engine = new ShadowMergeEngine(
        {
          mainRepoPath: this.git.repoPath,
          shadowWorktreePath: context.shadowWorktreePath,
          initialRef: context.initialRef,
          latestRef: context.latestRef,
          // We default to '3way' as Grizzco handles the high-level policy
          applyBackOnDirty: '3way',
          // Optional: propagate verbose level if available in context/options (omitted for brevity)
        },
        this.checkpoints,
        // Sidecar layer is optional in constructor, defaulting to no-op which is fine for pure sync
      );

      // We need to fetch base content to use mergeFileContents
      const baseContent = await this.git.show(context.initialRef, state.path);
      // User content from disk
      const userContent = await fs.readFile(state.absolutePath || state.path);
      // AI content from op
      const aiContent = op.content!;

      // Invoke legacy merge logic
      // private method: async mergeFileContents(repoPath, base, user, ai, options?)
      const result = await (engine as any).mergeFileContents(
        this.git.repoPath,
        baseContent,
        userContent,
        aiContent,
      );

      return {
        path: state.path,
        success: !result.conflict,
        mergedContent: result.merged,
        isConflict: result.conflict,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    } catch (error: unknown) {
      return {
        path: state.path,
        success: false,
        error: `Strata sync failed: ${error instanceof Error ? error.message : String(error)}`,
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }
  }
}
