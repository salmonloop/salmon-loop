import type { TaskEnvelope } from '../../interaction/model/index.js';
import type { CommandRunner } from '../../runtime/command-runner-context.js';
import {
  createLocalCommandRunner,
  withCommandRunner,
} from '../../runtime/command-runner-context.js';
import type { ToolAuthorizationProvider } from '../../tools/authorization/types.js';
import type { LoopEvent } from '../../types/index.js';

export function createSalmonTaskExecutor(deps: {
  runLoop: (options: {
    instruction: string;
    mode: string;
    onEvent?: (event: LoopEvent) => void;
    signal?: AbortSignal;
    authorizationProvider?: ToolAuthorizationProvider;
    authorizationMode?: 'blocking' | 'deferred';
  }) => Promise<unknown>;
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
      },
    ): Promise<TaskEnvelope> {
      const runner = options?.commandRunner ?? createLocalCommandRunner();
      await withCommandRunner(runner, async () => {
        await deps.runLoop({
          instruction: task.request.instruction,
          mode: task.capability,
          onEvent: options?.onEvent,
          signal: options?.signal,
          authorizationProvider: options?.authorizationProvider,
          authorizationMode: options?.authorizationMode,
        });
      });

      return {
        ...task,
        state: 'completed',
      };
    },
  };
}
