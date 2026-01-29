import { FileState, MergeResult, ShadowOperation } from '../../shared/types/grizzco-types.js';

export interface IMergeWorker {
  readonly id: string;

  /**
   * Execute the merge operation.
   * @param op The AI-generated operation.
   * @param state The current state of the file.
   * @param context Additional context (e.g., snapshot ID).
   */
  execute(
    op: ShadowOperation,
    state: FileState,
    context?: { snapshotId?: string; repoRoot?: string },
  ): Promise<MergeResult>;
}
