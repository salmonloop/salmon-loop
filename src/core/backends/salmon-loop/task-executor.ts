import type { TaskEnvelope } from '../../interaction/model/index.js';
import type { LoopResult } from '../../types/index.js';
import type { CommandRunner } from '../../runtime/command-runner-context.js';
import {
  createLocalCommandRunner,
  withCommandRunner,
} from '../../runtime/command-runner-context.js';
import type { ToolAuthorizationProvider } from '../../tools/authorization/types.js';
import type { FileSystem } from '../../types/index.js';
import type { LoopEvent } from '../../types/index.js';

export function createSalmonTaskExecutor(deps: {
  runLoop: (options: {
    instruction: string;
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

      return {
        ...task,
        state: 'completed',
      };
    },
  };
}
