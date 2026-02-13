import { runApplyBackPhase } from '../flows/flow-apply-back-runtime.js';
import { Step } from '../pipeline.js';
import { ShrinkCtx } from '../types.js';

function buildSkippedResult() {
  return {
    success: true,
    skipped: true,
    telemetry: {},
  };
}

export const runApplyBack: Step<ShrinkCtx, ShrinkCtx> = async (ctx) => {
  if (!ctx.verifyResult.ok || ctx.options.dryRun) {
    return {
      ...ctx,
      applyBackResult: buildSkippedResult(),
    };
  }

  const runtime = ctx.applyBackRuntime;
  if (!runtime || ctx.options.strategy !== 'worktree') {
    return {
      ...ctx,
      applyBackResult: buildSkippedResult(),
    };
  }

  const applyBackResult = await runApplyBackPhase({
    attempt: ctx.attempt ?? 1,
    options: ctx.options,
    checkpointRef: runtime.checkpointRef,
    initialSnapshotHash: runtime.initialSnapshotHash,
    synchronizer: runtime.synchronizer,
    activeRepoPath: runtime.activeRepoPath,
    shadowTaskId: runtime.shadowTaskId,
    diff: ctx.diff,
    changedFiles: ctx.changedFiles ?? [],
    emit: ctx.emit,
  });

  return {
    ...ctx,
    applyBackResult,
    ...(applyBackResult.success ? {} : { lastError: applyBackResult.error || 'Apply-back failed' }),
  };
};
