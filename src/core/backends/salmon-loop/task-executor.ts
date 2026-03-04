import type { TaskEnvelope } from '../../interaction/model/index.js';
import { mapErrorForDisplay } from '../../observability/error-mapping.js';
import type { CommandRunner } from '../../runtime/command-runner-context.js';
import {
  createLocalCommandRunner,
  withCommandRunner,
} from '../../runtime/command-runner-context.js';
import type { ToolAuthorizationProvider } from '../../tools/authorization/types.js';
import type { FileSystem } from '../../types/index.js';
import type { LoopEvent } from '../../types/index.js';
import type { LoopResult } from '../../types/index.js';

function inferFailureCategory(
  result: LoopResult,
): 'verification' | 'runtime' | 'policy' | 'infrastructure' {
  if (result.failurePhase === 'VERIFY' || result.reasonCode === 'VERIFY_FAILED') {
    return 'verification';
  }
  if (result.errorCode === 'AUTH_REQUIRED') {
    return 'policy';
  }
  if (
    result.failurePhase === 'PREFLIGHT' ||
    result.reasonCode === 'PREFLIGHT_NOT_GIT' ||
    result.reasonCode === 'PREFLIGHT_DIRTY' ||
    result.errorCode === 'PREFLIGHT_NOT_GIT' ||
    result.errorCode === 'PREFLIGHT_DIRTY'
  ) {
    return 'infrastructure';
  }
  return 'runtime';
}

export function createSalmonTaskExecutor(deps: {
  runLoop: (options: {
    instruction: string;
    checkpointSessionId?: string;
    repoPath?: string;
    mode: string;
    onEvent?: (event: LoopEvent) => void;
    signal?: AbortSignal;
    authorizationProvider?: ToolAuthorizationProvider;
    authorizationMode?: 'blocking' | 'deferred';
    fileSystemOverride?: FileSystem;
  }) => Promise<LoopResult>;
}) {
  return {
    async execute(
      task: TaskEnvelope,
      options?: {
        onEvent?: (event: LoopEvent) => void;
        signal?: AbortSignal;
        authorizationProvider?: ToolAuthorizationProvider;
        authorizationMode?: 'blocking' | 'deferred';
        commandRunner?: CommandRunner;
        fileSystemOverride?: FileSystem;
      },
    ): Promise<TaskEnvelope> {
      const runner = options?.commandRunner ?? createLocalCommandRunner();
      const result = await withCommandRunner(runner, async () => {
        return await deps.runLoop({
          instruction: task.request.instruction,
          checkpointSessionId: task.request.checkpointSessionId,
          repoPath: task.request.repoPath,
          mode: task.capability,
          onEvent: options?.onEvent,
          signal: options?.signal,
          authorizationProvider: options?.authorizationProvider,
          authorizationMode: options?.authorizationMode,
          fileSystemOverride: options?.fileSystemOverride,
        });
      });

      if (result.reasonCode === 'AWAITING_INPUT' && result.inputRequired) {
        return {
          ...task,
          state: 'awaiting_input',
          statusMessage: result.inputRequired.prompt,
          inputRequired: result.inputRequired,
        };
      }

      if (!result.success) {
        const failureCode = result.errorCode ?? result.reasonCode ?? 'LOOP_FAILED';
        const failureMessage = mapErrorForDisplay({
          message: result.reason,
          code: failureCode,
        }).message;
        return {
          ...task,
          state: 'failed',
          statusMessage: failureMessage,
          failure: {
            code: failureCode,
            message: failureMessage,
            category: inferFailureCategory(result),
          },
        };
      }

      return {
        ...task,
        state: 'completed',
      };
    },
  };
}
