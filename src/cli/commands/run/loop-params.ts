import type { PermissionMode } from '../../../core/config/types.js';
import type { CheckpointStrategy, LLMMessage } from '../../../core/types/index.js';
import { createTerminalAuthorizationProvider } from '../../authorization/provider.js';

export function buildRunLoopParams(params: {
  instruction: string;
  verify?: string;
  repoPath: string;
  llm: any;
  conversationContext?: LLMMessage[];
  mode: any;
  dryRun?: boolean;
  forceReset?: boolean;
  file?: string;
  selection?: unknown[];
  verbose?: any;
  checkpointStrategy?: CheckpointStrategy;
  environmentMode?: 'strict' | 'parity';
  applyBackOnDirty: any;
  worktreePrepare?: any;
  llmOutput: any;
  outcomeReporter?: any;
  auditScope?: 'repo' | 'user';
  langfuseSessionId?: string;
  langfuseUserId?: string;
  toolAuthorization: any;
  astValidation?: { strictness?: 'lenient' | 'strict' };
  extensions?: any;
  headlessOutput: boolean;
  printMode: boolean;
  headlessIncludeToolInput: boolean;
  headlessIncludeToolOutput: boolean;
  headlessIncludeAuthorizationDecisions: boolean;
  allowOutsideCacheRoot: boolean;
  permissionRules?: { allow: string[]; deny: string[] };
  permissionMode: PermissionMode;
}) {
  return {
    instruction: params.instruction,
    verify: params.verify,
    repoPath: params.repoPath,
    llm: params.llm,
    conversationContext: params.conversationContext,
    mode: params.mode,
    dryRun: params.dryRun,
    forceReset: params.forceReset,
    file: params.file,
    selection: params.selection,
    verbose: params.verbose,
    strategy: params.checkpointStrategy,
    environmentMode: params.environmentMode,
    applyBackOnDirty: params.applyBackOnDirty,
    worktreePrepare: params.worktreePrepare,
    llmOutput: params.llmOutput,
    outcomeReporter: params.outcomeReporter,
    auditScope: params.auditScope,
    langfuseSessionId: params.langfuseSessionId,
    langfuseUserId: params.langfuseUserId,
    astValidation: params.astValidation,
    allowOutsideCacheRoot: params.allowOutsideCacheRoot,
    authorizationProvider: createTerminalAuthorizationProvider({
      config: params.toolAuthorization,
      extensions: params.extensions,
      forceNonInteractive: params.headlessOutput || params.printMode,
      permissionMode: params.permissionMode,
    }),
    extensions: params.extensions,
    permissionRules: params.permissionRules,
    eventPayload:
      params.headlessIncludeToolInput ||
      params.headlessIncludeToolOutput ||
      params.headlessIncludeAuthorizationDecisions
        ? {
            includeToolInput: params.headlessIncludeToolInput,
            includeToolOutput: params.headlessIncludeToolOutput,
            includeAuthorizationDecisions: params.headlessIncludeAuthorizationDecisions,
          }
        : undefined,
  };
}
