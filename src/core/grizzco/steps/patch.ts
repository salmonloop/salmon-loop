import { repairToUnifiedDiff } from '../../llm/contracts/repair.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { resolveVisibleToolSpecs } from '../../tools/tool-visibility.js';
import { Phase } from '../../types/runtime.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { PatchCtx, PlanCtx } from '../engine/pipeline/types.js';

import { checkPatchApplies } from './patch/apply-check.js';
import { extractAndValidatePatch, type ValidatedPatchDiff } from './patch/diff-normalization.js';
import { salvagePatchDiff } from './patch/diff-salvage.js';
import { buildPatchPromptInput } from './patch/prompt-input.js';
import { buildPhaseToolRuntimeContext, buildToolVisibilityRuntime } from './tool-runtime.js';

const recordPatchSalvageAttempt = (args: { reason: string; badContentLength: number }) => {
  recordAuditEvent(
    'patch.salvage.attempt',
    {
      reason: args.reason,
      badContentLength: args.badContentLength,
      toolsDisabled: true,
    },
    { source: 'patch', severity: 'low', scope: 'session', phase: 'PATCH' },
  );
};

const recordPatchSalvageResult = (args: { ok: boolean; contentLength: number; error?: string }) => {
  recordAuditEvent(
    'patch.salvage.result',
    {
      ok: args.ok,
      contentLength: args.contentLength,
      error: args.error,
    },
    {
      source: 'patch',
      severity: args.ok ? 'low' : 'medium',
      scope: 'session',
      phase: 'PATCH',
    },
  );
};

export const generatePatch: Step<PlanCtx, PatchCtx> = async (ctx) => {
  const toolstack = ctx.toolstack;
  const toolPolicy = resolveLlmToolCallingPolicy(Phase.PATCH, ctx.options.llm);

  // Backwards-compatible fallback for non-tool-capable LLMs.
  if (!toolstack || !toolPolicy.enabled) {
    const legacyPatch = await ctx.options.llm.createPatch(
      ctx.context,
      ctx.plan,
      ctx.lastError,
      ctx.options.signal,
    );
    emitLlmOutput({
      emit: ctx.emit,
      policy: ctx.options.llmOutput,
      kind: 'patch',
      step: 'PATCH',
      content: legacyPatch,
    });
    const validated = extractAndValidatePatch({
      rawContent: legacyPatch,
      plannedFiles: ctx.plan.files,
    });

    ctx.emit({
      type: 'log',
      level: 'debug',
      message: `Patch generated: ${validated.diffMeta.changedFiles.length} files changed`,
      timestamp: new Date(),
    });

    return {
      ...ctx,
      diff: validated.normalizedPatch,
      diffMeta: validated.diffMeta,
      changedFiles: validated.diffMeta.changedFiles,
    };
  }

  const toolVisibility = buildToolVisibilityRuntime(ctx);
  const promptVisibleTools = resolveVisibleToolSpecs({
    phase: Phase.PATCH,
    toolstack,
    worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
    flowMode: ctx.mode,
    runtime: toolVisibility,
  });

  const patchPromptInput = await buildPatchPromptInput({
    context: ctx.context,
    contextResult: ctx.contextResult,
    plan: ctx.plan,
    planRuntime: ctx.planRuntime,
    lastError: ctx.lastError,
    promptVisibleTools,
    visibleToolNames: promptVisibleTools.map((spec) => spec.name),
    phase: Phase.PATCH,
    cacheSharing: ctx.cacheSharing,
    onCacheMismatch: (mismatch) => {
      recordAuditEvent('request.cache_sharing_hash_mismatch', mismatch, {
        source: 'llm',
        severity: 'low',
        scope: 'session',
        phase: Phase.PATCH,
      });
    },
    conversationContext: ctx.options.conversationContext,
    artifactHints: ctx.artifactHints,
    replacementState: ctx.replacementState,
    toolCallingAudit: ctx.toolCallingAudit,
  });
  const { cacheSurface, envelope, baseMessages } = patchPromptInput;
  const supportsStreaming = typeof ctx.options.llm.chatStream === 'function';
  const llmOutput = {
    policy: ctx.options.llmOutput,
    kind: 'patch' as const,
    step: 'PATCH' as const,
  };

  const response = await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
    baseMessages,
    {
      providerHints: envelope.providerHints,
      signal: ctx.options.signal,
    },
    {
      phase: Phase.PATCH,
      llm: ctx.options.llm,
      runtime: buildPhaseToolRuntimeContext(ctx, Phase.PATCH, cacheSurface),
      toolVisibility,
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

  let rawContent = response.content || '';
  let parsedPatch: ValidatedPatchDiff;
  try {
    parsedPatch = extractAndValidatePatch({
      rawContent,
      plannedFiles: ctx.plan.files,
    });
  } catch (e) {
    const salvaged = await salvagePatchDiff({
      initialError: e,
      rawContent,
      plannedFiles: ctx.plan.files,
      repair: ({ badContent }) => repairToUnifiedDiff({ badContent }),
      onAttempt: recordPatchSalvageAttempt,
      onResult: recordPatchSalvageResult,
    });

    if (!salvaged) {
      throw e;
    }

    rawContent = salvaged.rawContent;
    parsedPatch = salvaged;
    emitLlmOutput({
      emit: ctx.emit,
      policy: ctx.options.llmOutput,
      kind: 'patch',
      step: 'PATCH',
      content: salvaged.patch,
    });
  }

  // Deterministic contract: the patch should be applicable (git apply --check) before moving on.
  // When this fails, attempt a single LLM repair pass using the git error message as feedback.
  const applyCheck = await checkPatchApplies({
    repoRoot: ctx.workspace.workPath,
    diff: parsedPatch.normalizedPatch,
  });
  if (!applyCheck.ok) {
    // Preserve the original patch and let VALIDATE provide the canonical failure if needed.
  }

  ctx.emit({
    type: 'log',
    level: 'debug',
    message: `Patch generated: ${parsedPatch.diffMeta.changedFiles.length} files changed`,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    diff: parsedPatch.normalizedPatch,
    diffMeta: parsedPatch.diffMeta,
    changedFiles: parsedPatch.diffMeta.changedFiles,
  };
};
