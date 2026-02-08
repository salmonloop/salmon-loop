import { text } from '../../../locales/index.js';
import { formatContextForPrompt } from '../../llm-utils.js';
import { getExplorePrompt, getExploreSystemPrompt } from '../../prompt.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { Phase, RelatedFileContext, SalmonError } from '../../types.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../pipeline.js';
import { ContextCtx, ExploreCtx } from '../types.js';
import { ContextValidator } from '../validation/ContextValidator.js';

export const exploreCodebase: Step<ContextCtx, ExploreCtx> = async (ctx) => {
  const toolstack = ctx.toolstack;
  const toolPolicy = resolveLlmToolCallingPolicy(Phase.EXPLORE, ctx.options.llm);

  // If tools are not available or disabled, skip exploration
  if (!toolstack || !toolPolicy.enabled) {
    ctx.emit({
      type: 'log',
      level: 'debug',
      message: 'Exploration skipped (tools disabled or unavailable)',
      timestamp: new Date(),
    });
    return { ...ctx };
  }

  const prompt = await getExplorePrompt(
    formatContextForPrompt(ctx.context),
    ctx.options.instruction,
    ctx.lastError,
  );

  const systemPrompt = await getExploreSystemPrompt(toolstack.registry);

  const supportsStreaming = typeof ctx.options.llm.chatStream === 'function';
  const llmOutput = {
    policy: ctx.options.llmOutput,
    kind: 'explore' as const,
    step: 'EXPLORE' as const,
  };

  // We need to capture files read during exploration to pass them to the Plan phase.
  // We use the tool intent metadata to identify read operations.
  const capturedFiles = new Map<string, string>();

  const proxiedRouter = {
    ...toolstack.router,
    call: async (envelope: any) => {
      const result = await toolstack.router.call(envelope);

      // Find the corresponding audit entry to check intent
      const intent = toolstack.registry.getSpec(result.toolName)?.intent;

      // Intercept tools with READ intent
      if (intent === 'READ' && result.status === 'ok' && typeof result.output === 'string') {
        try {
          // Attempt to parse arguments to get the file path
          // envelope.args should be the parsed arguments object
          const args = envelope.args;
          if (args && typeof args.path === 'string') {
            capturedFiles.set(args.path, result.output);
          }
        } catch {
          // Ignore parsing errors, just don't capture
        }
      }
      return result;
    },
  };

  const proxiedToolstack = {
    ...toolstack,
    router: proxiedRouter,
  };

  await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    {
      signal: ctx.options.signal,
    },
    {
      phase: Phase.EXPLORE,
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
      toolstack: proxiedToolstack,
      toolCallingAudit: {
        event: (entry) => {
          const list = ctx.toolCallingAudit ?? [];
          list.push(entry);
          ctx.toolCallingAudit = list;
        },
      },
      maxRounds: toolPolicy.maxRounds ?? 15,
      llmOutput,
      emit: (event) => ctx.emit({ ...event, timestamp: event.timestamp ?? new Date() }),
    },
  );

  // Validation: Check for exploration consistency using ContextValidator
  if (ctx.toolCallingAudit) {
    const validation = ContextValidator.validateExploration(
      ctx.toolCallingAudit as any,
      capturedFiles.size,
    );
    if (!validation.isValid) {
      const msg = (text.grizzco.validation as any)[validation.errorCode!] || validation.errorCode;
      throw new SalmonError(msg, 'EXPLORATION_VALIDATION_FAILED');
    }
  }

  // Update context with captured files
  const updatedContext = { ...ctx.context };
  const existingFiles = new Set(updatedContext.relatedFiles?.map((f) => f.path) || []);

  const newRelatedFiles: RelatedFileContext[] = updatedContext.relatedFiles
    ? [...updatedContext.relatedFiles]
    : [];

  for (const [path, content] of capturedFiles) {
    if (!existingFiles.has(path) && path !== updatedContext.primaryFile) {
      newRelatedFiles.push({
        path,
        content,
        kind: 'dependency', // Mark explored files as dependencies/context
        mode: 'full',
      });
      existingFiles.add(path); // Prevent duplicates
    }
  }

  updatedContext.relatedFiles = newRelatedFiles;

  ctx.emit({
    type: 'log',
    level: 'info',
    message: `Exploration finished. Added ${capturedFiles.size} files to context.`,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    context: updatedContext,
    explorationSummary: {
      filesFound: capturedFiles.size,
      toolCallCount: ctx.toolCallingAudit?.length || 0,
    },
  };
};
