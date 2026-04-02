import type { ToolRuntimeCtx } from '../../tools/types.js';
import type { ExecutionPhase } from '../../types/runtime.js';
import type { ContextCtx } from '../engine/pipeline/types.js';

export function buildPhaseToolRuntimeContext(
  ctx: Pick<
    ContextCtx,
    'workspace' | 'attempt' | 'options' | 'artifactHints' | 'toolCallingAudit' | 'planRuntime'
  >,
  phase: ExecutionPhase,
  cacheSurface: {
    namespace?: string;
    contextHash?: string;
  },
): ToolRuntimeCtx {
  return {
    repoRoot: ctx.workspace.workPath,
    persistenceRoot: ctx.workspace.baseRepoPath || ctx.workspace.workPath,
    worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
    attemptId: ctx.attempt ?? 1,
    dryRun: Boolean(ctx.options?.dryRun),
    llm: ctx.options.llm,
    model: ctx.options.llm.getModelId?.() || process.env.SALMONLOOP_MODEL || process.env.S8P_MODEL,
    userInputProvider: ctx.options.userInputProvider,
    agentKind: ctx.options.agentKind ?? 'primary',
    languagePlugins: ctx.options.languagePlugins,
    subAgentController: ctx.options.subAgentController,
    phase,
    contextSnapshot: {
      conversationContext: ctx.options.conversationContext,
      artifactHints: ctx.artifactHints,
      toolCallingAudit: ctx.toolCallingAudit,
      planRuntime: ctx.planRuntime,
      cacheSharing: {
        namespace: cacheSurface.namespace,
        contextHash: cacheSurface.contextHash,
      },
    },
  };
}
