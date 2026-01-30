import { text } from '../../../locales/index.js';
import { createStandardToolstack } from '../../tools/loader.js';
import { preflight } from '../../verify.js';
import { Step } from '../pipeline.js';
import { InitCtx, PreflightCtx } from '../types.js';

export const runPreflight: Step<InitCtx, PreflightCtx> = async (ctx) => {
  const result = await preflight(ctx.workspace);

  if (!result.ok) {
    ctx.emit({
      type: 'log',
      level: 'error',
      message: result.reason || text.loop.preflightFailedNotGit,
      timestamp: new Date(),
    });
    throw new Error(result.reason || text.loop.preflightFailedNotGit);
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.loop.preflightPassed,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    preflightResult: result,
    // Toolstack is created once per attempt to ensure consistent policy/budget/audit behavior.
    toolstack: createStandardToolstack({
      repoRoot: ctx.workspace.workPath,
      worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
      attemptId: (ctx as any).attempt ?? 1,
      dryRun: Boolean(ctx.options?.dryRun),
      model:
        (ctx.options.llm as any)?.getModelId?.() ||
        process.env.S8P_MODEL ||
        process.env.SALMON_MODEL,
    }),
  };
};
