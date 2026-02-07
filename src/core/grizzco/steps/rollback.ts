import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { CheckpointManager } from '../../strata/checkpoint/manager.js';
import { Step } from '../pipeline.js';
import type { InitCtx } from '../types.js';
import { AstValidateCtx, RollbackCtx, VerifyCtx } from '../types.js';

type RollbackTargetCtx = Pick<InitCtx, 'options' | 'workspace' | 'shadowInitialRef' | 'emit'> & {
  changedFiles?: string[];
};

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
export const runEmergencyRollback: Step<AstValidateCtx, AstValidateCtx> = async (ctx) => {
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

/**
 * Executes Git rollback to restore workspace to initial snapshot state.
 *
 * ROLLBACK SEMANTICS - STATE MACHINE INTERPRETATION:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Return value { rolledBack: boolean } indicates STATE, not OPERATION.
 *
 * Common Misunderstanding:
 * ❌ "rolledBack: true means rollback operation was executed"
 * ✅ Correct: "rolledBack: true means system IS IN expected rollback state"
 *
 * State Machine Logic:
 * ┌──────────────────────┬─────────────┬──────────────────────────────┐
 * │ Scenario             │ rolledBack  │ Meaning                      │
 * ├──────────────────────┼─────────────┼──────────────────────────────┤
 * │ Has anchor + executed│ true        │ Rollback performed           │
 * │ No anchor (clean)    │ true        │ Already in target state      │
 * │ Skipped by policy    │ false       │ Rollback not needed          │
 * └──────────────────────┴─────────────┴──────────────────────────────┘
 *
 * Why "No Anchor" Returns true (Idempotency Pattern):
 * - No shadowInitialRef = workspace never modified (no snapshot needed)
 * - Workspace ALREADY in "clean" state we want
 * - Returning true = "postcondition (clean state) is satisfied"
 * - NOT "lying" - it's correct state machine semantics
 *
 * Analogy:
 *   Q: "Is the door closed?"
 *   A: If never opened → YES (current state, not action history)
 *
 * Design Pattern (Command Pattern + Idempotency):
 * - Executing rollback() multiple times reaches same end state
 * - State matters, not whether action was taken
 *
 * See: docs/design/execution-contract.md, docs/design/checkpoint.md
 */
async function executeGitRollback<T extends RollbackTargetCtx>(
  ctx: T,
): Promise<T & { rolledBack: boolean }> {
  const shadowInitialRef = ctx.shadowInitialRef || ctx.options?.shadowInitialRef;

  if (!shadowInitialRef) {
    // No snapshot anchor exists - workspace never modified
    // System already in target state (no rollback needed)
    ctx.emit?.({
      type: 'log',
      level: 'warn', // Warn (not error) - expected edge case
      message: text.loop.rollbackSkippedNoAnchor,
      timestamp: new Date(),
    });

    // STATE MACHINE: Return true because postcondition satisfied
    // Workspace IS in expected clean state (no modified files)
    return {
      ...ctx,
      rolledBack: true, // "In rollback state" (not "rollback executed")
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
