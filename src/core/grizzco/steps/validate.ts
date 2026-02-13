import { text } from '../../../locales/index.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { PatchCtx, ValidateCtx } from '../engine/pipeline/types.js';

export const validatePatch: Step<PatchCtx, ValidateCtx> = async (ctx) => {
  // Validation logic
  const isValid = ctx.diffMeta !== null;

  if (!isValid) {
    ctx.emit({
      type: 'log',
      level: 'error',
      message: text.loop.patchValidationFailed,
      timestamp: new Date(),
    });
    throw new Error(text.loop.patchValidationFailed);
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.loop.diffValidationPassed,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    isValid,
  };
};
