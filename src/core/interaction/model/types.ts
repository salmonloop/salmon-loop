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

export interface TaskEnvelope {
  id: string;
  capability: string;
  state: TaskState;
  tenantId?: string;
  request: TaskRequest;
  createdAt: string;
}
