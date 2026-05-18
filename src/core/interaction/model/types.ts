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
  checkpointSessionId?: string;
  repoPath?: string;
  extensions?: import('../../extensions/types.js').ResolvedExtensions;
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
  reason?: 'approval' | 'clarification' | 'reopen';
  prompt: string;
  questions?: import('../../types/index.js').AskUserQuestion[];
  responseFormat?: 'json';
}

export interface TaskFailure {
  code: string;
  category?: 'verification' | 'runtime' | 'policy' | 'infrastructure';
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
