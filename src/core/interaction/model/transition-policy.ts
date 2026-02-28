import type { TaskState } from './types.js';

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  accepted: ['running', 'cancelled'],
  running: ['streaming', 'awaiting_input', 'completed', 'failed', 'cancelled'],
  awaiting_input: ['running', 'cancelled'],
  streaming: ['running', 'awaiting_input', 'completed', 'failed', 'cancelled'],
  completed: ['awaiting_input'],
  failed: ['accepted', 'awaiting_input'],
  cancelled: ['accepted', 'awaiting_input'],
};

export interface TaskTransitionPolicy {
  allows(from: TaskState, to: TaskState): boolean;
  allowedTargets(from: TaskState): TaskState[];
  isResumable(state: TaskState): boolean;
  isRetryable(state: TaskState): boolean;
  isReopenable(state: TaskState): boolean;
}

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
  };
}
