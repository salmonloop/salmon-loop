import type { CheckpointStrategy } from '../../../core/types/index.js';
import { createTerminalAuthorizationProvider } from '../../authorization/provider.js';

export function buildRunLoopParams(params: {
  instruction: string;
  verify?: string;
  repoPath: string;
  llm: any;
  mode: any;
  dryRun?: boolean;
  forceReset?: boolean;
  file?: string;
  selection?: unknown[];
  verbose?: any;
  checkpointStrategy?: CheckpointStrategy;
  applyBackOnDirty: any;
  worktreePrepare?: any;
  llmOutput: any;
  outcomeReporter?: any;
  langfuseSessionId?: string;
  langfuseUserId?: string;
  toolAuthorization: any;
  extensions?: any;
  headlessOutput: boolean;
  printMode: boolean;
  headlessIncludeToolInput: boolean;
  headlessIncludeToolOutput: boolean;
  permissionRules?: { allow: string[]; deny: string[] };
}) {
  return {
    instruction: params.instruction,
    verify: params.verify,
    repoPath: params.repoPath,
    llm: params.llm,
    mode: params.mode,
    dryRun: params.dryRun,
    forceReset: params.forceReset,
    file: params.file,
    selection: params.selection,
    verbose: params.verbose,
    strategy: params.checkpointStrategy,
    applyBackOnDirty: params.applyBackOnDirty,
    worktreePrepare: params.worktreePrepare,
    llmOutput: params.llmOutput,
    outcomeReporter: params.outcomeReporter,
    langfuseSessionId: params.langfuseSessionId,
    langfuseUserId: params.langfuseUserId,
    authorizationProvider: createTerminalAuthorizationProvider({
      config: params.toolAuthorization,
      extensions: params.extensions,
      forceNonInteractive: params.headlessOutput || params.printMode,
    }),
    extensions: params.extensions,
    permissionRules: params.permissionRules,
    eventPayload:
      params.headlessIncludeToolInput || params.headlessIncludeToolOutput
        ? {
            includeToolInput: params.headlessIncludeToolInput,
            includeToolOutput: params.headlessIncludeToolOutput,
          }
        : undefined,
  };
}
