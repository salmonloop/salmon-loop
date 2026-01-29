import { FileState, MergeResult, ShadowOperation } from '../../shared/types/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * Overwrite Binary Worker
 * Use case: Modifying binary files (no merge possible, just overwrite)
 */
export class OverwriteBinaryWorker implements IMergeWorker {
  readonly id = 'overwrite-binary';

  async execute(op: ShadowOperation, state: FileState): Promise<MergeResult> {
    const startTime = Date.now();

    if (!op.content) {
      return {
        path: state.path,
        success: false,
        error: 'Operation missing content for binary overwrite',
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }

    return {
      path: state.path,
      success: true,
      mergedContent: op.content,
      isConflict: false,
      workerId: this.id,
      executionTime: Date.now() - startTime,
    };
  }
}
