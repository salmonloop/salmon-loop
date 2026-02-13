import { ContextBuilder } from '../../context/builder.js';
import { CheckpointManager } from '../../strata/checkpoint/manager.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { ContextCtx, PreflightCtx } from '../engine/pipeline/types.js';

export const buildContext: Step<PreflightCtx, ContextCtx> = async (ctx) => {
  if (ctx.initialContext) {
    ctx.emit({
      type: 'log',
      level: 'debug',
      message: 'Using existing context (retry mode)',
      timestamp: new Date(),
    });
    return {
      ...ctx,
      context: ctx.initialContext,
    };
  }

  // In worktree strategy, build context from the shadow workspace to ensure the patch is generated
  // against the exact state that will be modified (prevents "patch does not apply" due to drift).
  const contextOptions =
    ctx.workspace?.strategy === 'worktree'
      ? {
          ...ctx.options,
          repoPath: ctx.workspace.workPath,
          snapshotHash: ctx.shadowInitialRef,
          checkpointManager: new CheckpointManager(),
        }
      : ctx.options;

  const builtContext = await ContextBuilder.build(contextOptions);

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: `Context built: ${builtContext.rgSnippets.length} snippets, ${builtContext.gitDiff ? 'with' : 'without'} git diff`,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    context: builtContext,
  };
};
