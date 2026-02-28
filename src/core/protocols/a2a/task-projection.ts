interface CanonicalTaskLike {
  id: string;
  state: string;
  capability?: string;
  tenantId?: string;
  createdAt?: string;
  attempt?: number;
  statusMessage?: string;
  failure?: {
    code: string;
    category?: 'verification' | 'runtime' | 'policy' | 'infrastructure';
    message: string;
    retryable?: boolean;
  };
  inputRequired?: {
    type: string;
    reason?: 'approval' | 'clarification' | 'reopen';
    prompt: string;
  };
  artifacts?: Array<{
    id: string;
    name: string;
    kind: string;
    mimeType?: string;
    content?: string;
    delivery?: 'inline' | 'handle' | 'url';
    handle?: string;
    url?: string;
    expiresAt?: string;
  }>;
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
      message: task.statusMessage,
    },
    failure: task.failure,
    requiredAction: task.inputRequired,
    artifacts: (task.artifacts ?? []).map((artifact) => ({
      artifactId: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      content: artifact.content,
      delivery: artifact.delivery,
      handle: artifact.handle,
      url: artifact.url,
      expiresAt: artifact.expiresAt,
    })),
    metadata: {
      capability: task.capability,
      tenantId: task.tenantId,
      attempt: task.attempt,
    },
  };
}
