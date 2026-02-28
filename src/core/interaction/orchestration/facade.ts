import type { TaskEventBus } from '../events/bus.js';
import type { TaskEnvelope, TaskRequest } from '../model/index.js';

import { InMemoryTaskStore } from './store.js';

export interface InteractionFacade {
  createTask(input: { capability: string; request: TaskRequest }): Promise<TaskEnvelope>;
  getTask(id: string): Promise<TaskEnvelope | null>;
  cancelTask(id: string): Promise<TaskEnvelope | null>;
  listTasks(): Promise<TaskEnvelope[]>;
}

export function createInteractionFacade(deps: {
  executeTask: (task: TaskEnvelope) => Promise<TaskEnvelope>;
  eventBus?: TaskEventBus;
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
      deps.eventBus?.publish({ type: 'task.accepted', taskId: task.id });
      void deps.executeTask(task).then((result) => {
        store.update(result);
        deps.eventBus?.publish({ type: 'task.completed', taskId: result.id });
      });
      return task;
    },
    async getTask(id) {
      return store.get(id);
    },
    async cancelTask(id) {
      const task = store.get(id);
      if (!task) return null;

      const cancelled = store.update({
        ...task,
        state: 'cancelled',
      });
      deps.eventBus?.publish({ type: 'task.cancelled', taskId: cancelled.id });
      return cancelled;
    },
    async listTasks() {
      return store.list();
    },
  };
}
