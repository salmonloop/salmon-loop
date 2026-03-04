import { CheckpointManager } from '../strata/checkpoint/manager.js';

import {
  linkSessionToCheckpoint,
  readCheckpointManifest,
  removeCheckpointHandle,
  upsertCheckpointHandle,
} from './manifest-store.js';
import type {
  CheckpointHandle,
  CreateCheckpointInput,
  DeleteCheckpointInput,
  ListCheckpointInput,
  LoadCheckpointInput,
} from './types.js';

export interface CheckpointService {
  create(input: CreateCheckpointInput): Promise<CheckpointHandle>;
  load(input: LoadCheckpointInput): Promise<CheckpointHandle | null>;
  resume(input: LoadCheckpointInput): Promise<CheckpointHandle | null>;
  list(input: ListCheckpointInput): Promise<CheckpointHandle[]>;
  delete(input: DeleteCheckpointInput): Promise<void>;
}

export class GitSnapshotCheckpointService implements CheckpointService {
  constructor(private readonly checkpointManager: CheckpointManager = new CheckpointManager()) {}

  async create(input: CreateCheckpointInput): Promise<CheckpointHandle> {
    const snapshot = await this.checkpointManager.createSafeSnapshot(
      input.repoPath,
      input.includePaths ?? [],
      input.message,
    );
    const handle: CheckpointHandle = {
      id: snapshot.commitHash,
      createdAt: new Date().toISOString(),
      parentId: input.parentId,
      strategy: input.strategy,
      backend: 'git_snapshot',
      metadata: {
        ...(input.metadata ?? {}),
        stagedTree: snapshot.stagedTree,
      },
    };
    await upsertCheckpointHandle(input.repoPath, handle);
    if (input.sessionId) {
      await linkSessionToCheckpoint(input.repoPath, input.sessionId, handle.id);
    }
    return handle;
  }

  async load(input: LoadCheckpointInput): Promise<CheckpointHandle | null> {
    const manifest = await readCheckpointManifest(input.repoPath);
    return manifest.checkpoints[input.checkpointId] ?? null;
  }

  async resume(input: LoadCheckpointInput): Promise<CheckpointHandle | null> {
    return this.load(input);
  }

  async list(input: ListCheckpointInput): Promise<CheckpointHandle[]> {
    const manifest = await readCheckpointManifest(input.repoPath);
    if (!input.sessionId) {
      const values = Object.values(manifest.checkpoints);
      if (!input.limit || input.limit <= 0) return values;
      return values.slice(0, input.limit);
    }
    const link = manifest.sessions[input.sessionId];
    if (!link) return [];
    const handles = link.history
      .map((checkpointId) => manifest.checkpoints[checkpointId])
      .filter((value): value is CheckpointHandle => Boolean(value));
    if (!input.limit || input.limit <= 0) return handles;
    return handles.slice(-input.limit);
  }

  async delete(input: DeleteCheckpointInput): Promise<void> {
    await this.checkpointManager.deleteSnapshot(input.repoPath, input.checkpointId);
    await removeCheckpointHandle(input.repoPath, input.checkpointId);
  }
}
