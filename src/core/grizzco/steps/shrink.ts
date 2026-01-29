import { ContextBuilder } from '../../context.js';
import { refineFeedback } from '../../feedback/index.js';
import { Step } from '../pipeline.js';
import { RollbackCtx, ShrinkCtx } from '../types.js';

function classifyError(output: string): string {
  if (output.includes('compile') || output.includes('syntax')) return 'SYNTAX';
  if (output.includes('import') || output.includes('require')) return 'IMPORT';
  if (output.includes('type') || output.includes('interface')) return 'TYPE';
  return 'LOGIC';
}

export const runShrink: Step<RollbackCtx, ShrinkCtx> = async (ctx) => {
  if (!ctx.verifyResult.ok) {
    // Only shrink if verification failed
    const failedFiles = ContextBuilder.extractFailedFiles(ctx.verifyResult.output);
    const errorType = classifyError(ctx.verifyResult.output);

    const newContext = await ContextBuilder.shrinkContext(
      ctx.context,
      failedFiles,
      errorType as any,
    );

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
