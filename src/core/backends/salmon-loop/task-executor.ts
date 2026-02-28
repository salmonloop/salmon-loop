import type { TaskEnvelope } from '../../interaction/model/index.js';

export function createSalmonTaskExecutor(deps: {
  runLoop: (options: { instruction: string; mode: string }) => Promise<unknown>;
}) {
  return {
    async execute(task: TaskEnvelope): Promise<TaskEnvelope> {
      await deps.runLoop({
        instruction: task.request.instruction,
        mode: task.capability,
      });

      return {
        ...task,
        state: 'completed',
      };
    },
  };
}
