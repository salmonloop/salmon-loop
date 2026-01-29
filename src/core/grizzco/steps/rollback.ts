import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { CheckpointManager } from '../../strata/checkpoint/manager.js';
import { Step } from '../pipeline.js';
import { RollbackCtx, VerifyCtx } from '../types.js';

/**
 * Normal Rollback (triggered by verification failure or user request)
 */
export const runRollback: Step<VerifyCtx, RollbackCtx> = async (ctx) => {
  const shouldRollback = !ctx.verifyResult.ok || ctx.options.forceReset;

  if (!shouldRollback || ctx.options.dryRun) {
    return {
      ...ctx,
      rolledBack: false,
    };
  }

  return executeGitRollback(ctx);
};

/**
 * Emergency Rollback (triggered by pipeline exception)
 * Works with any context that might have changedFiles
 */
export const runEmergencyRollback: Step<any, any> = async (ctx) => {
  if (ctx.options?.dryRun) {
    return ctx;
  }

  try {
    // Only attempt rollback if we have modified files and a snapshot
    if (ctx.changedFiles && ctx.changedFiles.length > 0) {
      ctx.emit?.({
        type: 'log',
        level: 'warn',
        message: text.loop.emergencyRollbackTriggered,
        timestamp: new Date(),
      });
      await executeGitRollback(ctx);
    }
  } catch (error) {
    // Emergency rollback failed - log but don't crash (we are already in error handling)
    ctx.emit?.({
      type: 'log',
      level: 'error',
      message: text.loop.emergencyRollbackFailed(String(error)),
      timestamp: new Date(),
    });
  }

  return ctx;
};

async function executeGitRollback(ctx: any): Promise<any> {
  const shadowInitialRef = ctx.shadowInitialRef || ctx.options?.shadowInitialRef;

  if (!shadowInitialRef) {
    ctx.emit?.({
      type: 'log',
      level: 'warn',
      message: text.loop.rollbackSkippedNoAnchor,
      timestamp: new Date(),
    });

    return {
      ...ctx,
      rolledBack: true,
    };
  }

  // Worktree strategy needs a snapshot-aware rollback to preserve staged/unstaged semantics.
  // `git checkout <snapshot> -- <path>` mutates the index and can break MM handling in retries.
  if (ctx.workspace?.strategy === 'worktree') {
    const checkpoints = new CheckpointManager();
    await checkpoints.restoreToShadow(
      ctx.workspace.baseRepoPath || ctx.options?.repoPath,
      ctx.workspace.workPath,
      shadowInitialRef,
    );
  } else {
    const git = new GitAdapter(ctx.workspace.workPath);
    const paths = ctx.changedFiles && ctx.changedFiles.length > 0 ? ctx.changedFiles : ['.'];
    await git.safeRollback(paths, shadowInitialRef);
  }

  ctx.emit?.({
    type: 'log',
    level: 'info',
    message: text.loop.rollbackCompleted,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    rolledBack: true,
  };
}
