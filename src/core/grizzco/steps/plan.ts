import { text } from '../../../locales/index.js';
import { LIMITS } from '../../config/limits.js';
import { sanitizeError } from '../../llm/errors.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { formatContextForPrompt, parsePlanFromLLMContent } from '../../llm/utils.js';
import { readPlan, updatePlan } from '../../plan/index.js';
import { getPlanPrompt, getPlanSystemPrompt } from '../../prompts/runtime.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { Phase, type Plan } from '../../types.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { ContextCtx, PlanCtx } from '../engine/pipeline/types.js';

function sanitizeSubtaskText(raw: string): string | null {
  const oneLine = String(raw ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!oneLine) return null;

  // Prevent metadata injection (our plan format uses HTML comments for stable IDs).
  const withoutComments = oneLine.replaceAll('<!--', '').replaceAll('-->', '').trim();
  if (!withoutComments) return null;

  const maxLen = 180;
  if (withoutComments.length <= maxLen) return withoutComments;
  return withoutComments.slice(0, maxLen - 1).trimEnd() + '…';
}

async function hydrateRuntimePlanTodos(ctx: ContextCtx, plan: Plan): Promise<void> {
  const runtime = ctx.planRuntime;
  if (!runtime?.sessionId) return;

  const persistenceRoot = ctx.workspace.baseRepoPath || ctx.workspace.workPath;
  const res = await readPlan({ persistenceRoot, sessionId: runtime.sessionId });

  const existingNonRoot = [...res.active, ...res.pending, ...res.recentDone].some(
    (s) => s?.stepId && s.stepId !== 'work_root',
  );
  if (existingNonRoot) return;

  const candidates =
    Array.isArray(plan.changes) && plan.changes.length > 0
      ? plan.changes
      : Array.isArray(plan.files)
        ? plan.files.map((f) => `Edit ${f}`)
        : [];

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const sanitized = sanitizeSubtaskText(c);
    if (!sanitized || seen.has(sanitized)) continue;
    seen.add(sanitized);
    unique.push(sanitized);
    if (unique.length >= 32) break;
  }

  if (unique.length === 0) return;

  await updatePlan({
    persistenceRoot,
    sessionId: runtime.sessionId,
    baseHash: res.baseHash,
    stepId: 'work_root',
    patch: {
      appendSubtasks: unique,
    },
  });
}

export const generatePlan: Step<ContextCtx, PlanCtx> = async (ctx) => {
  const toolstack = ctx.toolstack;
  const toolPolicy = resolveLlmToolCallingPolicy(Phase.PLAN, ctx.options.llm);

  // Backwards-compatible fallback: keep non-tool-capable LLMs on the legacy createPlan path.
  if (!toolstack || !toolPolicy.enabled) {
    const plan = await ctx.options.llm.createPlan(
      ctx.context,
      ctx.options.instruction,
      ctx.lastError,
      ctx.options.signal,
    );

    emitLlmOutput({
      emit: ctx.emit,
      policy: ctx.options.llmOutput,
      kind: 'plan',
      step: 'PLAN',
      content: JSON.stringify(plan, null, 2),
    });

    ctx.emit({
      type: 'log',
      level: 'debug',
      message: `Plan generated: ${plan.goal}`,
      timestamp: new Date(),
    });

    // Best-effort: keep runtime plan actionable even if the LLM doesn't call plan.* tools.
    await hydrateRuntimePlanTodos(ctx, plan).catch(() => {});

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

  const systemPrompt = await getPlanSystemPrompt(toolstack?.registry, { plan: ctx.planRuntime });

  const supportsStreaming = typeof ctx.options.llm.chatStream === 'function';
  const llmOutput = {
    policy: ctx.options.llmOutput,
    kind: 'plan' as const,
    step: 'PLAN' as const,
  };

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
        attemptId: ctx.attempt ?? 1,
        dryRun: Boolean(ctx.options?.dryRun),
        llm: ctx.options.llm,
        model: ctx.options.llm.getModelId?.() || process.env.S8P_MODEL || process.env.SALMON_MODEL,
      },
      toolstack,
      toolCallingAudit: {
        event: (entry) => {
          const list = ctx.toolCallingAudit ?? [];
          list.push(entry);
          ctx.toolCallingAudit = list;
        },
      },
      maxRounds: toolPolicy.maxRounds,
      llmOutput,
      emit: (event) => ctx.emit({ ...event, timestamp: event.timestamp ?? new Date() }),
    },
  );

  const content = response.content;
  if (!content) {
    throw new Error(text.llm.planEmpty);
  }

  let plan: Plan;
  try {
    plan = parsePlanFromLLMContent(content);
  } catch (e) {
    throw new Error(text.llm.planParseFailed(content, sanitizeError(e)));
  }

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: `Plan generated: ${plan.goal}`,
    timestamp: new Date(),
  });

  // Best-effort: keep runtime plan actionable even if the LLM doesn't call plan.* tools.
  await hydrateRuntimePlanTodos(ctx, plan).catch(() => {});

  return {
    ...ctx,
    plan,
  };
};
