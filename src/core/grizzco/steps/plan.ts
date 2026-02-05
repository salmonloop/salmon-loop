import { text } from '../../../locales/index.js';
import { LIMITS } from '../../limits.js';
import { formatContextForPrompt, parsePlanFromLLMContent } from '../../llm-utils.js';
import { getPlanPrompt, getPlanSystemPrompt } from '../../prompt.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { Phase } from '../../types.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../pipeline.js';
import { ContextCtx, PlanCtx } from '../types.js';

export const generatePlan: Step<ContextCtx, PlanCtx> = async (ctx) => {
  const toolstack = (ctx as any).toolstack;
  const toolPolicy = resolveLlmToolCallingPolicy(Phase.PLAN, ctx.options.llm);

  // Backwards-compatible fallback: keep non-tool-capable LLMs on the legacy createPlan path.
  if (!toolstack || !toolPolicy.enabled) {
    const plan = await ctx.options.llm.createPlan(
      ctx.context,
      ctx.options.instruction,
      ctx.lastError,
      ctx.options.signal,
    );

    ctx.emit({
      type: 'log',
      level: 'debug',
      message: `Plan generated: ${plan.goal}`,
      timestamp: new Date(),
    });

    return {
      ...ctx,
      plan,
    };
  }

  const prompt = await getPlanPrompt(
    formatContextForPrompt(ctx.context),
    ctx.options.instruction,
    LIMITS.maxFilesChanged,
    ctx.lastError,
  );

  const systemPrompt = await getPlanSystemPrompt(toolstack?.registry);

  const supportsStreaming = typeof (ctx.options.llm as any)?.chatStream === 'function';

  const response = await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
    [
      {
        role: 'system',
        content: systemPrompt,
      },
      { role: 'user', content: prompt },
    ],
    {
      responseFormat: 'json_object',
      signal: ctx.options.signal,
    },
    {
      phase: Phase.PLAN,
      llm: ctx.options.llm,
      runtime: {
        repoRoot: ctx.workspace.workPath,
        persistenceRoot: ctx.workspace.baseRepoPath || ctx.workspace.workPath,
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
      emitStreamChunk: ctx.options.onStreamChunk,
      emit: (e) =>
        ctx.emit({
          type: 'log',
          level: e.level,
          message: e.message,
          timestamp: new Date(),
        }),
    },
  );

  const content = response.content;
  if (!content) {
    throw new Error(text.llm.planEmpty);
  }

  let plan: any;
  try {
    plan = parsePlanFromLLMContent(content);
  } catch (e) {
    throw new Error(text.llm.planParseFailed(content, String(e)));
  }

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: `Plan generated: ${plan.goal}`,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    plan,
  };
};
