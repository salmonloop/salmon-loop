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
}

export interface TaskRequiredAction {
  type: string;
  prompt: string;
}

export interface TaskEnvelope {
  id: string;
  capability: string;
  state: TaskState;
  tenantId?: string;
  request: TaskRequest;
  createdAt: string;
  statusMessage?: string;
  inputRequired?: TaskRequiredAction;
  artifacts?: TaskArtifact[];
}
