import { normalizeDiff, validateDiff } from '../../diff.js';
import { LIMITS } from '../../limits.js';
import { extractUnifiedDiffFromLLMContent, formatContextForPrompt } from '../../llm-utils.js';
import { getPatchPrompt } from '../../prompts.js';
import { chatWithTools } from '../../tools/session.js';
import { Phase } from '../../types.js';
import { Step } from '../pipeline.js';
import { PatchCtx, PlanCtx } from '../types.js';

export const generatePatch: Step<PlanCtx, PatchCtx> = async (ctx) => {
  const toolstack = (ctx as any).toolstack;
  const llmImplName = (ctx.options.llm as any)?.constructor?.name;

  // Backwards-compatible fallback for non-OpenAI LLMs.
  if (!toolstack || llmImplName !== 'OpenAILLM') {
    const patch = await ctx.options.llm.createPatch(ctx.context, ctx.plan, (ctx as any).lastError);
    const normalizedPatch = normalizeDiff(patch);
    const diffMeta = validateDiff(normalizedPatch);

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
  const prompt = getPatchPrompt(
    planStr,
    formatContextForPrompt(ctx.context),
    LIMITS.maxFilesChanged,
    LIMITS.maxDiffLines,
    (ctx as any).lastError,
  );

  const response = await chatWithTools(
    [
      {
        role: 'system',
        content:
          'You are SalmonLoop. Use tool calls to inspect the repository when needed. Output only a valid unified diff when patching.',
      },
      { role: 'user', content: prompt },
    ],
    {},
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
  const diffMeta = validateDiff(normalizedPatch);

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
