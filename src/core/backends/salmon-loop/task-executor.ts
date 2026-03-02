import type { TaskEnvelope } from '../../interaction/model/index.js';
import type { LoopEvent } from '../../types/index.js';

export function createSalmonTaskExecutor(deps: {
  runLoop: (options: {
    instruction: string;
    mode: string;
    onEvent?: (event: LoopEvent) => void;
    signal?: AbortSignal;
  }) => Promise<unknown>;
}) {
  return {
    async execute(
      task: TaskEnvelope,
      options?: { onEvent?: (event: LoopEvent) => void; signal?: AbortSignal },
    ): Promise<TaskEnvelope> {
      await deps.runLoop({
        instruction: task.request.instruction,
        mode: task.capability,
        onEvent: options?.onEvent,
        signal: options?.signal,
      });

      return {
        ...task,
        state: 'completed',
      };
    },
  };
}
