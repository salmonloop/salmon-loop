import { ContextBuilder } from '../../context.js';
import { refineFeedback } from '../../feedback/index.js';
import { classifyError } from '../../verify.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { RollbackCtx, ShrinkCtx } from '../engine/pipeline/types.js';

function inferDependencyDepth(output: string): number {
  const lower = output.toLowerCase();

  if (
    lower.includes('cannot find module') ||
    lower.includes('module not found') ||
    lower.includes('cannot find name') ||
    lower.includes('is not defined') ||
    lower.includes('type') ||
    lower.includes('interface') ||
    /ts\d{3,5}/i.test(output)
  ) {
    return 2;
  }

  return 1;
}

export const runShrink: Step<RollbackCtx, ShrinkCtx> = async (ctx) => {
  if (!ctx.verifyResult.ok) {
    // Only shrink if verification failed
    const failedFiles = ContextBuilder.extractFailedFiles(ctx.verifyResult.output);
    const errorType = classifyError(ctx.verifyResult.output);
    const dependencyDepth = inferDependencyDepth(ctx.verifyResult.output);

    const newContext = await ContextBuilder.shrinkContext(ctx.context, failedFiles, {
      errorType,
      dependencyDepth,
    });

    const lastError = refineFeedback(ctx.verifyResult.output);

    ctx.emit({
      type: 'log',
      level: 'debug',
      message: 'Context shrunk for retry',
      timestamp: new Date(),
    });

    return {
      ...ctx,
      context: newContext,
      lastError,
      shrunk: true,
    };
  }

  return {
    ...ctx,
    shrunk: false,
  };
};
