import { text } from '../../../locales/index.js';
import { LIMITS } from '../../config/limits.js';
import { runCommand } from '../../verification/runner.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { PreflightCtx, PrepareDepsCtx } from '../engine/pipeline/types.js';

export const runPrepareDeps: Step<PreflightCtx, PrepareDepsCtx> = async (ctx) => {
  const command = ctx.options.worktreePrepare?.trim();
  if (ctx.workspace.strategy !== 'worktree' || !command) {
    return ctx;
  }

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: text.loop.worktreePrepareDebug(command),
    timestamp: new Date(),
  });

  const prepareResult = await runCommand(
    ctx.workspace.workPath,
    command,
    LIMITS.worktreePrepareTimeoutMs,
  );

  if (!prepareResult.ok) {
    const message = text.loop.worktreePrepareFailed(prepareResult.output);
    const error = new Error(message) as Error & { code?: string };
    error.code = 'DEPENDENCY_ERROR';
    throw error;
  }

  return ctx;
};
