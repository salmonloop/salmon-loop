import type { TaskEnvelope, TaskRequest } from '../model/index.js';

import { InMemoryTaskStore } from './store.js';

export interface InteractionFacade {
  createTask(input: { capability: string; request: TaskRequest }): Promise<TaskEnvelope>;
  getTask(id: string): Promise<TaskEnvelope | null>;
  cancelTask(id: string): Promise<TaskEnvelope | null>;
}

export function createInteractionFacade(deps: {
  executeTask: (task: TaskEnvelope) => Promise<TaskEnvelope>;
}): InteractionFacade {
  const store = new InMemoryTaskStore();

  return {
    async createTask(input) {
      const task: TaskEnvelope = {
        id: `task_${Date.now()}`,
        capability: input.capability,
        state: 'accepted',
        request: input.request,
        createdAt: new Date().toISOString(),
      };
      store.save(task);
      void deps.executeTask(task).then((result) => {
        store.update(result);
      });
      return task;
    },
    async getTask(id) {
      return store.get(id);
    },
    async cancelTask(id) {
      const task = store.get(id);
      if (!task) return null;

      return store.update({
        ...task,
        state: 'cancelled',
      });
    },
  };
}
