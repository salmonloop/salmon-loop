/**
 * ImmutableGitLayer - Layer 1 Git Snapshot Management
 *
 * Wraps existing CheckpointManager to provide StrataSystem interface
 * for L1 Git snapshot and worktree operations.
 */

import { CheckpointManager } from '../checkpoint/manager.js';
import type { ImmutableGitLayer } from '../types.js';

/**
 * ImmutableGitLayer Implementation
 */
export class ImmutableGitLayerImpl implements ImmutableGitLayer {
  private checkpointManager: CheckpointManager;

  constructor() {
    this.checkpointManager = new CheckpointManager();
  }

  /**
   * Create a snapshot of the current repository state
   */
  async snapshot(): Promise<string> {
    const result = await this.checkpointManager.createSafeSnapshot(process.cwd());
    return result.commitHash;
  }

  /**
   * Checkout snapshot to shadow worktree
   */
  async checkout(shadowPath: string, commitHash: string): Promise<void> {
    await this.checkpointManager.restoreToShadow(process.cwd(), shadowPath, commitHash);
  }

  /**
   * Get file content from snapshot
   */
  async getFile(path: string): Promise<Buffer | null> {
    try {
      const content = await this.checkpointManager.getSnapshotFileContent(
        process.cwd(),
        'HEAD',
        path,
      );
      return Buffer.from(content);
    } catch {
      return null;
    }
  }
}
