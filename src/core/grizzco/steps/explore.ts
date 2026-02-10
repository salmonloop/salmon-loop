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
      message: text.grizzco.validation.explorationSkipped,
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

  // Report missing events for the explore phase
  ctx.emit({
    type: 'phase.start',
    phase: Phase.EXPLORE,
    timestamp: new Date(),
  });

  const supportsStreaming = typeof ctx.options.llm.chatStream === 'function';
  const llmOutput = {
    policy: ctx.options.llmOutput,
    kind: 'explore' as const,
    step: 'EXPLORE' as const,
  };

  // We need to capture files read during exploration to pass them to the Plan phase.
  // We use the tool intent metadata to identify read operations.
  const capturedFiles = new Map<string, string>();

  const proxiedRouter = new Proxy(toolstack.router, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'call' && typeof value === 'function') {
        return async (envelope: any) => {
          const result = await value.apply(target, [envelope]);

          if (!result || typeof result !== 'object') return result;

          // Find the corresponding spec to check intent
          const spec = toolstack.registry.listAll().find((s) => s.name === result.toolName);
          const intent = spec?.intent;

          // Intercept tools with READ intent
          if (intent === 'READ' && result.status === 'ok') {
            const output = result.output;
            const content = typeof output === 'string' ? output : (output as any)?.content;

            if (typeof content === 'string') {
              try {
                // Attempt to parse arguments to get the file path
                // Support multiple common parameter names: file, file_path, filePath, path
                const args = envelope.args || envelope.input;
                const filePath = args?.file || args?.file_path || args?.filePath || args?.path;

                if (typeof filePath === 'string') {
                  capturedFiles.set(filePath, content);
                }
              } catch {
                // Ignore parsing errors, just don't capture
              }
            }
          }
          return result;
        };
      }
      return value;
    },
  });

  const proxiedToolstack = {
    ...toolstack,
    router: proxiedRouter,
  };

  const localAudit: any[] = [];
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
          localAudit.push(entry);
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

  // Validation: Check for exploration consistency using ContextValidator on LOCAL audit
  const validation = ContextValidator.validateExploration(localAudit as any, capturedFiles.size);
  if (!validation.isValid) {
    const msg = (text.grizzco.validation as any)[validation.errorCode!] || validation.errorCode;
    throw new SalmonError(msg, 'EXPLORATION_VALIDATION_FAILED');
  }

  // Update context with captured files
  const updatedContext = { ...ctx.context };
  const newRelatedFiles: RelatedFileContext[] = updatedContext.relatedFiles
    ? [...updatedContext.relatedFiles]
    : [];

  // Track existing files to update them or add new ones
  const fileMap = new Map<string, RelatedFileContext>();
  newRelatedFiles.forEach((f) => fileMap.set(f.path, f));

  for (const [path, content] of capturedFiles) {
    if (path === updatedContext.primaryFile) continue;

    if (fileMap.has(path)) {
      // Update content for existing file
      const existing = fileMap.get(path)!;
      existing.content = content;
      existing.mode = 'full';
    } else {
      // Add as new dependency
      newRelatedFiles.push({
        path,
        content,
        kind: 'dependency',
        mode: 'full',
      });
    }
  }

  updatedContext.relatedFiles = newRelatedFiles;

  // Report the end of the explore phase
  ctx.emit({
    type: 'phase.end',
    phase: Phase.EXPLORE,
    success: true,
    timestamp: new Date(),
  });

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.grizzco.validation.explorationFinished(capturedFiles.size),
    timestamp: new Date(),
  });

  return {
    ...ctx,
    context: updatedContext,
    explorationSummary: {
      filesFound: capturedFiles.size,
      toolCallCount: localAudit.length,
    },
  };
};
