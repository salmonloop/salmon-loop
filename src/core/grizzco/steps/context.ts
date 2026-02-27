import { resolveConfig } from '../../config/resolve.js';
import { applyBudgetAdjustment } from '../../context/budget/integration.js';
import { ContextBuilder } from '../../context/builder.js';
import { setChurnRankingPolicy } from '../../context/targeting/churn-policy.js';
import type { ContextResult } from '../../context/types.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
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

  // Apply dynamic budget adjustment if enabled and on retry
  const config = await resolveConfig({ repoRoot: ctx.options.repoPath });
  setChurnRankingPolicy({
    primaryBoost: config.raw?.context?.churn?.weight?.primary,
    rerankWeight: config.raw?.context?.churn?.weight?.rerank,
    tieBreakWeight: config.raw?.context?.churn?.weight?.tiebreak,
  });
  if (config.context.dynamicBudget.enabled && (ctx.attempt ?? 0) > 1) {
    const currentBudget = contextOptions.budgetChars ?? 30000;
    const adjustment = applyBudgetAdjustment(currentBudget);

    if (adjustment) {
      contextOptions.budgetChars = adjustment.newBudget;

      ctx.emit({
        type: 'log',
        level: 'info',
        message: `Budget adjusted: ${currentBudget} → ${adjustment.newBudget} (${adjustment.reason})`,
        timestamp: new Date(),
      });

      recordAuditEvent(
        'context.budget.adjusted',
        {
          oldBudget: currentBudget,
          newBudget: adjustment.newBudget,
          reason: adjustment.reason,
          attempt: ctx.attempt,
        },
        {
          source: 'context',
          severity: 'low',
          scope: 'session',
          phase: 'CONTEXT',
        },
      );
    }
  }

  const contextResult: ContextResult = await ContextBuilder.build(contextOptions);

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: `Context built: ${contextResult.context.rgSnippets.length} snippets, ${contextResult.context.gitDiff ? 'with' : 'without'} git diff`,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    context: contextResult.context,
    contextResult,
  };
};
