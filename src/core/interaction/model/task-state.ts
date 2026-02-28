import type { TaskState } from './types.js';

export function isTerminalTaskState(state: TaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  accepted: ['running', 'cancelled'],
  running: ['streaming', 'awaiting_input', 'completed', 'failed', 'cancelled'],
  awaiting_input: ['running', 'cancelled'],
  streaming: ['running', 'awaiting_input', 'completed', 'failed', 'cancelled'],
  completed: ['awaiting_input'],
  failed: ['accepted', 'awaiting_input'],
  cancelled: ['accepted', 'awaiting_input'],
};

export function canTransitionTaskState(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}
