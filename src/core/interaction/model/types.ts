export type TaskState =
  | 'accepted'
  | 'running'
  | 'awaiting_input'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskRequest {
  instruction: string;
}

export interface TaskArtifact {
  id: string;
  name: string;
  kind: string;
  mimeType?: string;
  content?: string;
  delivery?: 'inline' | 'handle' | 'url';
  handle?: string;
  url?: string;
  expiresAt?: string;
}

export interface TaskRequiredAction {
  type: string;
  prompt: string;
}

export interface TaskFailure {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface TaskEnvelope {
  id: string;
  capability: string;
  state: TaskState;
  tenantId?: string;
  request: TaskRequest;
  createdAt: string;
  attempt?: number;
  statusMessage?: string;
  failure?: TaskFailure;
  inputRequired?: TaskRequiredAction;
  artifacts?: TaskArtifact[];
}
