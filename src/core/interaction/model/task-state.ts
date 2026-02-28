import { createTaskTransitionPolicy } from './transition-policy.js';
import type { TaskState } from './types.js';

export function isTerminalTaskState(state: TaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

const transitionPolicy = createTaskTransitionPolicy();

export function canTransitionTaskState(from: TaskState, to: TaskState): boolean {
  return transitionPolicy.allows(from, to);
}
