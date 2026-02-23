import { text } from '../../../locales/index.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { AstValidateCtx, ValidateCtx } from '../engine/pipeline/types.js';
import { resolveAstValidationStrictness } from '../validation/ast-validation-policy.js';
import { AstValidationService } from '../validation/AstValidationService.js';

export const validateAst: Step<ValidateCtx, AstValidateCtx> = async (ctx) => {
  const service = new AstValidationService();
  const strictness = resolveAstValidationStrictness({
    mode: ctx.mode,
    options: ctx.options,
  });
  const result = await service.validate({
    workPath: ctx.workspace.workPath,
    diff: ctx.diff,
    strictness,
  });

  if (!result.ok) {
    ctx.emit({
      type: 'log',
      level: 'error',
      message: text.loop.astValidationFailed(result.error || 'Unknown error'),
      timestamp: new Date(),
    });
    // We choose to abort pipeline if AST is invalid
    throw new Error(result.error || text.loop.astValidationFailed('Unknown error'));
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.loop.astValidationPassed,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    astValid: true,
    astError: undefined,
  };
};
