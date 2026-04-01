import { text } from '../../../locales/index.js';
import { LIMITS } from '../../config/limits.js';
import { repairToJsonObject } from '../../llm/contracts/repair.js';
import { sanitizeError } from '../../llm/errors.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import {
  buildArtifactHintAttachments,
  buildRequestEnvelope,
  materializeRequestEnvelope,
} from '../../llm/request-envelope.js';
import { formatContextForPrompt, parsePlanFromLLMContent } from '../../llm/utils.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { logIgnoredError } from '../../observability/ignored-error.js';
import { readPlan, updatePlan } from '../../plan/index.js';
import { getPlanPrompt, getPlanSystemPrompt } from '../../prompts/runtime.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import type { Plan } from '../../types/planning.js';
import { Phase } from '../../types/runtime.js';
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

function recordPlanRepairAttempt(args: { reason: string; badContentLength: number }) {
  recordAuditEvent(
    'plan.repair.attempt',
    {
      reason: args.reason,
      badContentLength: args.badContentLength,
      toolsDisabled: true,
    },
    { source: 'plan', severity: 'low', scope: 'session', phase: 'PLAN' },
  );
}

function recordPlanRepairResult(args: { ok: boolean; contentLength: number; error?: string }) {
  recordAuditEvent(
    'plan.repair.result',
    {
      ok: args.ok,
      contentLength: args.contentLength,
      error: args.error,
    },
    {
      source: 'plan',
      severity: args.ok ? 'low' : 'medium',
      scope: 'session',
      phase: 'PLAN',
    },
  );
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

export function hasSuccessfulPlanUpdateDuringPlan(
  ctx: Pick<ContextCtx, 'toolCallingAudit'>,
): boolean {
  const auditEntries = ctx.toolCallingAudit;
  if (!Array.isArray(auditEntries) || auditEntries.length === 0) return false;

  return auditEntries.some(
    (entry) =>
      entry.phase === Phase.PLAN &&
      entry.toolName === 'plan.update' &&
      entry.toolResultStatus === 'ok' &&
      entry.toolResultOutputOk === true,
  );
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

    if (ctx.planRuntime?.sessionId) {
      // Transitional fallback: legacy/non-tool PLAN runs may hydrate runtime subtasks from final JSON.
      await hydrateRuntimePlanTodos(ctx, plan).catch((error) =>
        logIgnoredError('[Plan] hydrate runtime plan todos (legacy)', error),
      );
    }

    return {
      ...ctx,
      plan,
    };
  }

  const contextPrompt = ctx.contextResult?.prompt ?? formatContextForPrompt(ctx.context);
  const prompt = await getPlanPrompt(
    contextPrompt,
    ctx.options.instruction,
    LIMITS.maxFilesChanged,
    ctx.lastError,
  );

  const promptVisibleTools = toolstack
    ? toolstack.registry.listAll().filter(
        (spec) =>
          toolstack.policy.decide(Phase.PLAN, spec, {
            worktreeRoot:
              ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
          }).allowed,
      )
    : undefined;

  const systemPrompt = await getPlanSystemPrompt(promptVisibleTools, { plan: ctx.planRuntime });
  const envelope = buildRequestEnvelope({
    system: systemPrompt,
    user: prompt,
    conversationContext: ctx.options.conversationContext,
    attachments: [
      {
        key: 'context-prompt',
        kind: 'context',
        label: 'Context prompt',
        content: contextPrompt,
        cacheSafe: true,
      },
      ...buildArtifactHintAttachments(ctx.artifactHints),
    ],
    cacheSafeSurface: {
      contextHash: ctx.contextResult?.meta?.contextHash ?? ctx.context.contextHash,
      namespace: 'plan',
    },
  });
  const baseMessages = materializeRequestEnvelope(envelope);

  const supportsStreaming = typeof ctx.options.llm.chatStream === 'function';
  const llmOutput = {
    policy: ctx.options.llmOutput,
    kind: 'plan' as const,
    step: 'PLAN' as const,
  };

  const response = await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
    baseMessages,
    {
      responseFormat: 'json_object',
      providerHints: envelope.providerHints,
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
        model:
          ctx.options.llm.getModelId?.() || process.env.SALMONLOOP_MODEL || process.env.S8P_MODEL,
        userInputProvider: ctx.options.userInputProvider,
        agentKind: ctx.options.agentKind ?? 'primary',
        languagePlugins: ctx.options.languagePlugins,
        subAgentController: ctx.options.subAgentController,
      },
      toolstack,
      eventPayload: ctx.options.eventPayload,
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
  let finalContent = content || '';

  let plan: Plan;
  try {
    if (!finalContent) {
      throw new Error(text.llm.planEmpty);
    }
    plan = parsePlanFromLLMContent(finalContent);
  } catch (e) {
    recordPlanRepairAttempt({
      reason: sanitizeError(e),
      badContentLength: finalContent.length,
    });
    let repaired: { content?: string };
    try {
      repaired = await repairToJsonObject({
        llm: ctx.options.llm,
        baseMessages,
        chatOptions: { signal: ctx.options.signal },
        badContent: finalContent,
        reason: sanitizeError(e),
      });
    } catch (repairError) {
      recordPlanRepairResult({
        ok: false,
        contentLength: 0,
        error: sanitizeError(repairError).slice(0, 400),
      });
      throw new Error(text.llm.planParseFailed(finalContent, sanitizeError(repairError)));
    }
    finalContent = repaired.content || '';

    emitLlmOutput({
      emit: ctx.emit,
      policy: ctx.options.llmOutput,
      kind: 'plan',
      step: 'PLAN',
      content: finalContent,
    });

    try {
      if (!finalContent) throw new Error(text.llm.planEmpty);
      plan = parsePlanFromLLMContent(finalContent);
    } catch (e2) {
      recordPlanRepairResult({
        ok: false,
        contentLength: finalContent.length,
        error: sanitizeError(e2).slice(0, 400),
      });
      throw new Error(text.llm.planParseFailed(finalContent, sanitizeError(e2)));
    }

    recordPlanRepairResult({
      ok: true,
      contentLength: finalContent.length,
    });
  }

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: `Plan generated: ${plan.goal}`,
    timestamp: new Date(),
  });

  const hasModelPlanUpdate = hasSuccessfulPlanUpdateDuringPlan(ctx);
  if (ctx.planRuntime?.sessionId && !hasModelPlanUpdate) {
    // Transitional fallback: only hydrate when PLAN did not successfully persist via plan.update.
    await hydrateRuntimePlanTodos(ctx, plan).catch((error) =>
      logIgnoredError('[Plan] hydrate runtime plan todos (tools)', error),
    );
  }

  return {
    ...ctx,
    plan,
  };
};
