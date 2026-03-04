export type CheckpointStrategy = 'worktree' | 'direct';

export type CheckpointBackend = 'git_snapshot';

export interface CheckpointHandle {
  id: string;
  createdAt: string;
  parentId?: string;
  strategy: CheckpointStrategy;
  backend: CheckpointBackend;
  metadata?: Record<string, unknown>;
}

export interface SessionCheckpointLink {
  sessionId: string;
  currentCheckpointId?: string;
  history: string[];
}

export interface CreateCheckpointInput {
  repoPath: string;
  strategy: CheckpointStrategy;
  includePaths?: string[];
  message?: string;
  sessionId?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface LoadCheckpointInput {
  repoPath: string;
  checkpointId: string;
}

export interface DeleteCheckpointInput {
  repoPath: string;
  checkpointId: string;
}

export interface ListCheckpointInput {
  repoPath: string;
  sessionId?: string;
  limit?: number;
}
