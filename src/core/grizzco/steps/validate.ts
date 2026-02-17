import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { PatchNotApplicableError } from '../../types/index.js';
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

  // Deterministic contract: the generated patch must be applicable to the current workspace.
  // This shifts "patch does not apply" failures from APPLY to VALIDATE, producing better feedback
  // for the next PATCH attempt.
  const git = new GitAdapter(ctx.workspace.workPath);
  const check = await git.execMeta(
    ['apply', '--check', '--recount', '--ignore-whitespace', '--whitespace=nowarn', '-'],
    {
      input: Buffer.from(ctx.diff, 'utf8'),
      timeoutMs: 15000,
      limits: { maxStdoutBytes: 0, maxStderrChars: 4000 },
    },
  );
  if (!check.ok) {
    const details = (check.stderr || '').trim();
    throw new PatchNotApplicableError(text.diff.patchDoesNotApply(details.slice(0, 2000)));
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
