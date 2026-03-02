import type { LoopEvent } from '../../types/index.js';
import type { TaskEventBus } from '../events/bus.js';
import {
  createTaskTransitionPolicy,
  type TaskEnvelope,
  type TaskFailure,
  type TaskRequest,
} from '../model/index.js';

import { InMemoryTaskStore } from './store.js';

export interface InteractionFacade {
  createTask(input: {
    capability: string;
    request: TaskRequest;
    onEvent?: (event: LoopEvent) => void;
  }): Promise<TaskEnvelope>;
  getTask(id: string): Promise<TaskEnvelope | null>;
  cancelTask(id: string): Promise<TaskEnvelope | null>;
  resumeTask(id: string): Promise<TaskEnvelope | null>;
  failTask(id: string, failure: TaskFailure): Promise<TaskEnvelope | null>;
  retryTask(id: string): Promise<TaskEnvelope | null>;
  reopenTask(
    id: string,
    action: { type: string; reason?: 'approval' | 'clarification' | 'reopen'; prompt: string },
  ): Promise<TaskEnvelope | null>;
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
  executeTask: (
    task: TaskEnvelope,
    options?: { onEvent?: (event: LoopEvent) => void },
  ) => Promise<TaskEnvelope>;
  eventBus?: TaskEventBus;
}): InteractionFacade {
  const store = new InMemoryTaskStore();
  const transitionPolicy = createTaskTransitionPolicy();

  function updateTask(
    id: string,
    nextState: TaskEnvelope['state'],
    mutate: (task: TaskEnvelope) => TaskEnvelope,
  ): TaskEnvelope | null {
    const task = store.get(id);
    if (!task) return null;
    if (!transitionPolicy.allows(task.state, nextState)) return null;
    return store.update(mutate(task));
  }

  return {
    async createTask(input) {
      const task: TaskEnvelope = {
        id: `task_${Date.now()}`,
        capability: input.capability,
        state: 'accepted',
        request: input.request,
        createdAt: new Date().toISOString(),
        attempt: 1,
      };
      store.save(task);
      deps.eventBus?.publish({ type: 'task.accepted', taskId: task.id });
      void deps.executeTask(task, { onEvent: input.onEvent }).then((result) => {
        store.update(result);
        if (result.state === 'completed') {
          deps.eventBus?.publish({ type: 'task.completed', taskId: result.id });
        } else if (result.state === 'failed') {
          deps.eventBus?.publish({ type: 'task.failed', taskId: result.id });
        } else if (result.state === 'awaiting_input') {
          deps.eventBus?.publish({ type: 'task.awaiting_input', taskId: result.id });
        }
      });
      return task;
    },
    async getTask(id) {
      return store.get(id);
    },
    async cancelTask(id) {
      const cancelled = updateTask(id, 'cancelled', (task) => ({
        ...task,
        state: 'cancelled',
      }));
      if (!cancelled) return null;
      deps.eventBus?.publish({
        type: 'task.cancelled',
        taskId: cancelled.id,
        state: cancelled.state,
        attempt: cancelled.attempt,
      });
      return cancelled;
    },
    async resumeTask(id) {
      const resumed = updateTask(id, 'running', (task) => ({
        ...task,
        state: 'running',
        statusMessage: 'Task resumed',
        inputRequired: undefined,
      }));
      if (!resumed) return null;
      deps.eventBus?.publish({
        type: 'task.resumed',
        taskId: resumed.id,
        state: resumed.state,
        attempt: resumed.attempt,
      });
      return resumed;
    },
    async failTask(id, failure) {
      const failed = updateTask(id, 'failed', (task) => ({
        ...task,
        state: 'failed',
        statusMessage: failure.message,
        failure,
      }));
      if (!failed) return null;
      deps.eventBus?.publish({
        type: 'task.failed',
        taskId: failed.id,
        state: failed.state,
        attempt: failed.attempt,
        failure: { category: failed.failure?.category, code: failed.failure?.code },
      });
      return failed;
    },
    async retryTask(id) {
      const current = store.get(id);
      if (!current) return null;
      if (!transitionPolicy.canRetry(current)) return null;
      const retried = updateTask(id, 'accepted', (task) => ({
        ...task,
        state: 'accepted',
        attempt: (task.attempt ?? 1) + 1,
        statusMessage: 'Task retried',
        failure: undefined,
        inputRequired: undefined,
      }));
      if (!retried) return null;
      deps.eventBus?.publish({
        type: 'task.retried',
        taskId: retried.id,
        state: retried.state,
        attempt: retried.attempt,
      });
      return retried;
    },
    async reopenTask(id, action) {
      const current = store.get(id);
      if (!current) return null;
      if (!transitionPolicy.canReopen(current)) return null;
      const reopened = updateTask(id, 'awaiting_input', (task) => ({
        ...task,
        state: 'awaiting_input',
        inputRequired: action,
        statusMessage: 'Task reopened',
      }));
      if (!reopened) return null;
      deps.eventBus?.publish({
        type: 'task.reopened',
        taskId: reopened.id,
        state: reopened.state,
        attempt: reopened.attempt,
        requiredAction: { type: action.type, reason: action.reason },
      });
      return reopened;
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
