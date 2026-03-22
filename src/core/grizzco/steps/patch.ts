import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { repairToUnifiedDiff } from '../../llm/contracts/repair.js';
import { wrapPatchEmpty, wrapPatchInvalid, wrapPatchNotUnifiedDiff } from '../../llm/errors.js';
import { composeChatMessages } from '../../llm/message-composition.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { extractUnifiedDiffFromLLMContent, formatContextForPrompt } from '../../llm/utils.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { normalizeDiff, validateDiff, type DiffMeta } from '../../patch/diff.js';
import { getPatchPrompt, getPatchSystemPrompt } from '../../prompts/runtime.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { DiffValidationError } from '../../types/errors.js';
import { Phase } from '../../types/runtime.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { PatchCtx, PlanCtx } from '../engine/pipeline/types.js';

function rewriteUniqueBasenameDiffPaths(diffText: string, plannedFiles: string[]): string {
  if (plannedFiles.length === 0) return diffText;

  const basenameMap = new Map<string, string | null>();
  for (const file of plannedFiles.map((item) => item.replace(/\\/g, '/'))) {
    const basename = file.split('/').at(-1);
    if (!basename) continue;
    const existing = basenameMap.get(basename);
    if (existing === undefined) {
      basenameMap.set(basename, file);
      continue;
    }
    if (existing !== file) {
      basenameMap.set(basename, null);
    }
  }

  const resolvePath = (candidate: string) => {
    const normalized = candidate.replace(/\\/g, '/');
    if (normalized === 'dev/null' || normalized.includes('/')) return candidate;
    const mapped = basenameMap.get(normalized);
    return mapped ?? candidate;
  };

  return diffText
    .replace(
      /^diff --git a\/(.+?) b\/(.+)$/gm,
      (_, left, right) => `diff --git a/${resolvePath(left)} b/${resolvePath(right)}`,
    )
    .replace(/^--- a\/(.+)$/gm, (_, left) => `--- a/${resolvePath(left)}`)
    .replace(/^\+\+\+ b\/(.+)$/gm, (_, right) => `+++ b/${resolvePath(right)}`);
}

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

const isCanonicalDiffHeader = (diffText: string): boolean =>
  diffText.trimStart().startsWith('diff --git ');

const assertCanonicalDiffHeader = (diffText: string) => {
  if (!diffText.trim()) {
    throw wrapPatchEmpty();
  }
  if (!isCanonicalDiffHeader(diffText)) {
    throw wrapPatchNotUnifiedDiff();
  }
};

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
    assertCanonicalDiffHeader(patch);
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

  const promptVisibleTools = toolstack
    ? toolstack.registry.listAll().filter(
        (spec) =>
          toolstack.policy.decide(Phase.PATCH, spec, {
            worktreeRoot:
              ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
          }).allowed,
      )
    : undefined;

  const systemPrompt = await getPatchSystemPrompt(promptVisibleTools, { plan: ctx.planRuntime });
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

  let rawContent = response.content || '';
  let patch = '';
  let normalizedPatch = '';
  let diffMeta: DiffMeta;

  const validateWithLlmErrors = (diffText: string): DiffMeta => {
    assertCanonicalDiffHeader(diffText);
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
    patch = rewriteUniqueBasenameDiffPaths(
      extractUnifiedDiffFromLLMContent(rawContent),
      ctx.plan.files,
    );
    normalizedPatch = normalizeDiff(patch);
    diffMeta = validateWithLlmErrors(patch);
  } catch (e) {
    const asLlmError = e;

    if (
      asLlmError instanceof Error &&
      'llmCode' in (asLlmError as any) &&
      ['LLM_PATCH_NOT_UNIFIED_DIFF', 'LLM_PATCH_EMPTY'].includes((asLlmError as any).llmCode)
    ) {
      recordPatchSalvageAttempt({
        reason: asLlmError.message,
        badContentLength: rawContent.length,
      });
      const repaired = await repairToUnifiedDiff({
        badContent: rawContent,
      });

      rawContent = repaired.content || '';

      try {
        patch = rewriteUniqueBasenameDiffPaths(
          extractUnifiedDiffFromLLMContent(rawContent),
          ctx.plan.files,
        );
        normalizedPatch = normalizeDiff(patch);
        diffMeta = validateWithLlmErrors(patch);
      } catch (salvageError) {
        const msg = salvageError instanceof Error ? salvageError.message : String(salvageError);
        recordPatchSalvageResult({
          ok: false,
          contentLength: rawContent.length,
          error: msg.slice(0, 400),
        });
        throw asLlmError;
      }

      recordPatchSalvageResult({
        ok: true,
        contentLength: rawContent.length,
      });

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
    // Preserve the original patch and let VALIDATE provide the canonical failure if needed.
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
