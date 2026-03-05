import type { TaskState } from './types.js';

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  accepted: ['running', 'cancelled'],
  running: ['streaming', 'awaiting_input', 'completed', 'failed', 'cancelled'],
  awaiting_input: ['running', 'cancelled'],
  streaming: ['running', 'awaiting_input', 'completed', 'failed', 'cancelled'],
  completed: ['awaiting_input', 'cancelled'],
  failed: ['accepted', 'awaiting_input'],
  cancelled: ['accepted', 'awaiting_input'],
};

export interface TaskTransitionPolicy {
  allows(from: TaskState, to: TaskState): boolean;
  allowedTargets(from: TaskState): TaskState[];
  isResumable(state: TaskState): boolean;
  isRetryable(state: TaskState): boolean;
  isReopenable(state: TaskState): boolean;
  canRetry(task: {
    state: TaskState;
    failure?: { category?: string; retryable?: boolean; code?: string; message?: string };
  }): boolean;
  canReopen(task: {
    state: TaskState;
    failure?: { category?: string; code?: string; message?: string; retryable?: boolean };
  }): boolean;
}

const RETRYABLE_FAILURE_CATEGORIES = new Set(['verification', 'runtime', 'infrastructure']);

export function createTaskTransitionPolicy(): TaskTransitionPolicy {
  return {
    allows(from, to) {
      return TASK_TRANSITIONS[from].includes(to);
    },
    allowedTargets(from) {
      return [...TASK_TRANSITIONS[from]];
    },
    isResumable(state) {
      return state === 'streaming' || state === 'awaiting_input';
    },
    isRetryable(state) {
      return state === 'failed' || state === 'cancelled';
    },
    isReopenable(state) {
      return state === 'completed' || state === 'failed' || state === 'cancelled';
    },
    canRetry(task) {
      if (!this.isRetryable(task.state)) return false;
      if (!task.failure) return false;
      if (!task.failure.retryable) return false;
      if (!task.failure.category) return false;
      return RETRYABLE_FAILURE_CATEGORIES.has(task.failure.category);
    },
    canReopen(task) {
      if (!this.isReopenable(task.state)) return false;
      if (task.state === 'completed') return true;
      if (!task.failure?.category) return false;
      return RETRYABLE_FAILURE_CATEGORIES.has(task.failure.category);
    },
  };
}
