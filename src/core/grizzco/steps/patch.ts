import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { repairToUnifiedDiff } from '../../llm/contracts/repair.js';
import { wrapPatchEmpty, wrapPatchInvalid, wrapPatchNotUnifiedDiff } from '../../llm/errors.js';
import { composeChatMessages } from '../../llm/message-composition.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { extractUnifiedDiffFromLLMContent, formatContextForPrompt } from '../../llm/utils.js';
import { normalizeDiff, validateDiff, type DiffMeta } from '../../patch/diff.js';
import { getPatchPrompt, getPatchSystemPrompt } from '../../prompts/runtime.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { DiffValidationError, Phase } from '../../types/index.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { PatchCtx, PlanCtx } from '../engine/pipeline/types.js';

async function checkPatchApplies(args: { repoRoot: string; diff: string }) {
  const git = new GitAdapter(args.repoRoot);
  return git.execMeta(
    ['apply', '--check', '--recount', '--ignore-whitespace', '--whitespace=nowarn', '-'],
    {
      input: Buffer.from(args.diff, 'utf8'),
      timeoutMs: 15000,
      limits: { maxStdoutBytes: 0, maxStderrChars: 4000 },
    },
  );
}

export const generatePatch: Step<PlanCtx, PatchCtx> = async (ctx) => {
  const toolstack = ctx.toolstack;
  const toolPolicy = resolveLlmToolCallingPolicy(Phase.PATCH, ctx.options.llm);

  // Backwards-compatible fallback for non-tool-capable LLMs.
  if (!toolstack || !toolPolicy.enabled) {
    const patch = await ctx.options.llm.createPatch(
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
      content: patch,
    });
    const normalizedPatch = normalizeDiff(patch);
    let diffMeta: DiffMeta;
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

  const systemPrompt = await getPatchSystemPrompt(toolstack?.registry, { plan: ctx.planRuntime });
  const baseMessages = composeChatMessages({
    system: systemPrompt,
    user: prompt,
    conversationContext: ctx.options.conversationContext,
  });
  const supportsStreaming = typeof ctx.options.llm.chatStream === 'function';
  const llmOutput = {
    policy: ctx.options.llmOutput,
    kind: 'patch' as const,
    step: 'PATCH' as const,
  };

  const response = await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
    baseMessages,
    {
      signal: ctx.options.signal,
    },
    {
      phase: Phase.PATCH,
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

  let rawContent = response.content || '';
  let patch = '';
  let normalizedPatch = '';
  let diffMeta: DiffMeta;

  const validateWithLlmErrors = (diffText: string): DiffMeta => {
    const normalized = normalizeDiff(diffText);
    try {
      return validateDiff(normalized);
    } catch (e) {
      if (e instanceof DiffValidationError) {
        if (e.message === text.diff.notUnifiedFormat) throw wrapPatchNotUnifiedDiff();
        if (e.message.startsWith(text.llm.patchEmpty())) throw wrapPatchEmpty();
        throw wrapPatchInvalid(e.message);
      }
      throw e;
    }
  };

  try {
    patch = extractUnifiedDiffFromLLMContent(rawContent);
    normalizedPatch = normalizeDiff(patch);
    diffMeta = validateWithLlmErrors(patch);
  } catch (e) {
    const asLlmError = e;

    if (
      asLlmError instanceof Error &&
      'llmCode' in (asLlmError as any) &&
      (asLlmError as any).llmCode &&
      ['LLM_PATCH_EMPTY', 'LLM_PATCH_NOT_UNIFIED_DIFF'].includes((asLlmError as any).llmCode)
    ) {
      let repaired: { content?: string };
      try {
        repaired = await repairToUnifiedDiff({
          llm: ctx.options.llm,
          baseMessages,
          chatOptions: { signal: ctx.options.signal },
          badContent: rawContent,
          reason: asLlmError.message,
        });
      } catch {
        throw asLlmError;
      }

      rawContent = repaired.content || '';

      patch = extractUnifiedDiffFromLLMContent(rawContent);
      normalizedPatch = normalizeDiff(patch);
      diffMeta = validateWithLlmErrors(patch);

      emitLlmOutput({
        emit: ctx.emit,
        policy: ctx.options.llmOutput,
        kind: 'patch',
        step: 'PATCH',
        content: patch,
      });
    } else {
      throw asLlmError;
    }
  }

  // Deterministic contract: the patch should be applicable (git apply --check) before moving on.
  // When this fails, attempt a single LLM repair pass using the git error message as feedback.
  const applyCheck = await checkPatchApplies({
    repoRoot: ctx.workspace.workPath,
    diff: normalizedPatch,
  });
  if (!applyCheck.ok) {
    const details = (applyCheck.stderr || '').trim();
    try {
      const repaired = await repairToUnifiedDiff({
        llm: ctx.options.llm,
        baseMessages,
        chatOptions: { signal: ctx.options.signal },
        badContent: patch,
        reason: `Patch does not apply cleanly: ${details.slice(0, 1200)}`,
      });

      rawContent = repaired.content || '';
      patch = extractUnifiedDiffFromLLMContent(rawContent);
      normalizedPatch = normalizeDiff(patch);
      diffMeta = validateWithLlmErrors(patch);

      const applyCheck2 = await checkPatchApplies({
        repoRoot: ctx.workspace.workPath,
        diff: normalizedPatch,
      });
      if (applyCheck2.ok) {
        emitLlmOutput({
          emit: ctx.emit,
          policy: ctx.options.llmOutput,
          kind: 'patch',
          step: 'PATCH',
          content: patch,
        });
      }
    } catch {
      // Preserve the original patch and let VALIDATE provide the canonical failure if needed.
    }
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
