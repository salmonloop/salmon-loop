import path from 'path';

import { text } from '../../../locales/index.js';
import { composeChatMessages } from '../../llm/message-composition.js';
import { formatContextForPrompt } from '../../llm/utils.js';
import { getExplorePrompt, getExploreSystemPrompt } from '../../prompts/runtime.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { type RelatedFileContext } from '../../types/context.js';
import { SalmonError } from '../../types/errors.js';
import { Phase } from '../../types/runtime.js';
import { ensureInSandbox, isSafeRelativePath, normalizePath } from '../../utils/path.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { ContextCtx, ExploreCtx } from '../engine/pipeline/types.js';
import { ContextValidator } from '../validation/ContextValidator.js';

const SAFE_INFERRED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.css',
  '.html',
  '.vue',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
]);

function inferHighConfidenceFiles(instruction: string): string[] {
  const candidates: string[] = [];
  const normalized = instruction || '';

  if (/README\b/i.test(normalized)) {
    candidates.push('README.md');
  }

  const pathLike = /(?:^|\s)([a-zA-Z0-9][a-zA-Z0-9._/-]*\.[a-zA-Z0-9]{1,8})(?:\s|$)/g;
  let match: RegExpExecArray | null = null;
  while ((match = pathLike.exec(normalized)) !== null) {
    const raw = match[1];
    if (!raw) continue;

    const rel = normalizePath(raw).replace(/^(\.\/|\/)+/, '');
    if (!rel) continue;
    if (!isSafeRelativePath(rel)) continue;

    const lower = rel.toLowerCase();
    if (lower.startsWith('.')) continue;
    if (lower.includes('/.')) continue;
    if (lower.startsWith('.git/') || lower.startsWith('.salmonloop/')) continue;
    if (lower.includes('node_modules/')) continue;

    const ext = path.extname(rel).toLowerCase();
    if (!SAFE_INFERRED_EXTENSIONS.has(ext)) continue;

    candidates.push(rel);
    if (candidates.length >= 3) break;
  }

  return Array.from(new Set(candidates));
}

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

  const systemPrompt = await getExploreSystemPrompt(toolstack.registry, { plan: ctx.planRuntime });

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
  const baseMessages = composeChatMessages({
    system: systemPrompt,
    user: prompt,
    conversationContext: ctx.options.conversationContext,
  });

  await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
    baseMessages,
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
        model:
          ctx.options.llm.getModelId?.() || process.env.SALMONLOOP_MODEL || process.env.S8P_MODEL,
        userInputProvider: ctx.options.userInputProvider,
        agentKind: ctx.options.agentKind ?? 'primary',
        languagePlugins: ctx.options.languagePlugins,
        subAgentController: ctx.options.subAgentController,
      },
      toolstack: proxiedToolstack,
      eventPayload: ctx.options.eventPayload,
      toolCallingAudit: {
        event: (entry) => {
          localAudit.push(entry);
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

  if (capturedFiles.size === 0 && !ctx.context.primaryText) {
    const inferred = inferHighConfidenceFiles(ctx.options.instruction);

    for (const rel of inferred) {
      try {
        const fullPath = ensureInSandbox(
          ctx.workspace.workPath,
          path.join(ctx.workspace.workPath, rel),
        );
        const content = await ctx.fs.readFile(fullPath, 'utf-8');
        if (typeof content === 'string' && content.trim()) {
          capturedFiles.set(rel, content);
        }
      } catch {
        // Best-effort; failure here should not abort exploration.
      }
    }
  }

  // Validation: Check for exploration consistency using ContextValidator on LOCAL audit
  const validation = ContextValidator.validateExploration(localAudit as any, capturedFiles.size);
  if (!validation.isValid) {
    const msg = (text.grizzco.validation as any)[validation.errorCode!] || validation.errorCode;
    ctx.emit({
      type: 'log',
      level: 'error',
      message: msg,
      timestamp: new Date(),
    });
    throw new SalmonError(msg, validation.errorCode);
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
