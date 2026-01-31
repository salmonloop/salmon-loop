import { text } from '../../../locales/index.js';
import { normalizeDiff, validateDiff } from '../../diff.js';
import { LIMITS } from '../../limits.js';
import { wrapPatchEmpty, wrapPatchInvalid, wrapPatchNotUnifiedDiff } from '../../llm/errors.js';
import { extractUnifiedDiffFromLLMContent, formatContextForPrompt } from '../../llm-utils.js';
import { getPatchPrompt, getPatchSystemPrompt } from '../../prompt.js';
import { chatWithTools } from '../../tools/session.js';
import { DiffValidationError, Phase } from '../../types.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../pipeline.js';
import { PatchCtx, PlanCtx } from '../types.js';

export const generatePatch: Step<PlanCtx, PatchCtx> = async (ctx) => {
  const toolstack = (ctx as any).toolstack;
  const toolPolicy = resolveLlmToolCallingPolicy(Phase.PATCH, ctx.options.llm);

  // Backwards-compatible fallback for non-tool-capable LLMs.
  if (!toolstack || !toolPolicy.enabled) {
    const patch = await ctx.options.llm.createPatch(
      ctx.context,
      ctx.plan,
      ctx.lastError,
      ctx.options.signal,
    );
    const normalizedPatch = normalizeDiff(patch);
    let diffMeta;
    try {
      diffMeta = validateDiff(normalizedPatch);
    } catch (e) {
      if (e instanceof DiffValidationError) {
        if (e.message === text.diff.notUnifiedFormat) throw wrapPatchNotUnifiedDiff();
        if (e.message.startsWith(text.llm.patchEmpty())) throw wrapPatchEmpty();
        throw wrapPatchInvalid(e.message);
      }
      throw e;
    }

    ctx.emit({
      type: 'log',
      level: 'debug',
      message: `Patch generated: ${diffMeta.changedFiles.length} files changed`,
      timestamp: new Date(),
    });

    return {
      ...ctx,
      diff: normalizedPatch,
      diffMeta,
      changedFiles: diffMeta.changedFiles,
    };
  }

  const planStr = JSON.stringify(ctx.plan, null, 2);
  const prompt = await getPatchPrompt(
    planStr,
    formatContextForPrompt(ctx.context),
    LIMITS.maxFilesChanged,
    LIMITS.maxDiffLines,
    ctx.lastError,
  );

  const systemPrompt = await getPatchSystemPrompt(toolstack?.registry);

  const response = await chatWithTools(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      { role: 'user', content: prompt },
    ],
    {
      signal: ctx.options.signal,
    },
    {
      phase: Phase.PATCH,
      llm: ctx.options.llm,
      runtime: {
        repoRoot: ctx.workspace.workPath,
        worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
        attemptId: (ctx as any).attempt ?? 1,
        dryRun: Boolean(ctx.options?.dryRun),
        model:
          (ctx.options.llm as any)?.getModelId?.() ||
          process.env.S8P_MODEL ||
          process.env.SALMON_MODEL,
      },
      toolstack,
      toolCallingAudit: {
        event: (entry) => {
          const list = ((ctx as any).toolCallingAudit as any[]) || [];
          list.push(entry);
          (ctx as any).toolCallingAudit = list;
        },
      },
      maxRounds: toolPolicy.maxRounds,
      emit: (e) =>
        ctx.emit({
          type: 'log',
          level: e.level,
          message: e.message,
          timestamp: new Date(),
        }),
    },
  );

  const patch = extractUnifiedDiffFromLLMContent(response.content || '');
  const normalizedPatch = normalizeDiff(patch);
  let diffMeta;
  try {
    diffMeta = validateDiff(normalizedPatch);
  } catch (e) {
    if (e instanceof DiffValidationError) {
      if (e.message === text.diff.notUnifiedFormat) throw wrapPatchNotUnifiedDiff();
      if (e.message.startsWith(text.llm.patchEmpty())) throw wrapPatchEmpty();
      throw wrapPatchInvalid(e.message);
    }
    throw e;
  }

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: `Patch generated: ${diffMeta.changedFiles.length} files changed`,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    diff: normalizedPatch,
    diffMeta,
    changedFiles: diffMeta.changedFiles,
  };
};
