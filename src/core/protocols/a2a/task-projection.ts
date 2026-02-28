interface CanonicalTaskLike {
  id: string;
  state: string;
  capability?: string;
  tenantId?: string;
  createdAt?: string;
}

type A2ATaskStatusState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

function projectTaskState(state: string): A2ATaskStatusState {
  if (state === 'accepted') return 'submitted';
  if (state === 'running' || state === 'streaming') return 'working';
  if (state === 'awaiting_input') return 'input-required';
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (state === 'cancelled') return 'canceled';
  return 'working';
}

export function projectCanonicalTaskToA2ATask(task: CanonicalTaskLike) {
  return {
    id: task.id,
    state: task.state,
    status: {
      state: projectTaskState(task.state),
      timestamp: task.createdAt ?? new Date().toISOString(),
    },
    metadata: {
      capability: task.capability,
      tenantId: task.tenantId,
    },
  };
}
