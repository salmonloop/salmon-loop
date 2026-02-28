import type { TaskEnvelope, TaskRequest } from '../model/index.js';

import { InMemoryTaskStore } from './store.js';

export interface InteractionFacade {
  createTask(input: { capability: string; request: TaskRequest }): Promise<TaskEnvelope>;
  getTask(id: string): Promise<TaskEnvelope | null>;
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
      void deps.executeTask(task);
      return task;
    },
    async getTask(id) {
      return store.get(id);
    },
  };
}
