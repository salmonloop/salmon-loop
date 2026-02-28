import type { TaskEventBus } from '../events/bus.js';
import type { TaskEnvelope, TaskRequest } from '../model/index.js';

import { InMemoryTaskStore } from './store.js';

export interface InteractionFacade {
  createTask(input: { capability: string; request: TaskRequest }): Promise<TaskEnvelope>;
  getTask(id: string): Promise<TaskEnvelope | null>;
  cancelTask(id: string): Promise<TaskEnvelope | null>;
  listTasks(query?: {
    capability?: string;
    state?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: TaskEnvelope[]; nextCursor?: string }>;
  submitInput(id: string, input: { type: string; value: string }): Promise<TaskEnvelope | null>;
  getArtifact(id: string, artifactId: string): Promise<TaskEnvelope | null>;
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
    async listTasks(query) {
      return store.list(query);
    },
    async submitInput(id, input) {
      const task = store.get(id);
      if (!task) return null;
      if (task.state !== 'awaiting_input') return null;
      if (task.inputRequired && task.inputRequired.type !== input.type) return null;

      return store.update({
        ...task,
        state: 'running',
        statusMessage: `Input received: ${input.value}`,
        inputRequired: undefined,
      });
    },
    async getArtifact(id, artifactId) {
      const task = store.get(id);
      if (!task) return null;
      const artifact = task.artifacts?.find((candidate) => candidate.id === artifactId);
      if (!artifact) return null;
      return {
        ...task,
        artifacts: [artifact],
      };
    },
  };
}
