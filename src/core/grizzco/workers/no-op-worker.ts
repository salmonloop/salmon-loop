import { FileState, MergeResult, ShadowOperation } from '../domain/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * NoOpWorker
 * Does nothing. Useful for skipping files successfully.
 */
export class NoOpWorker implements IMergeWorker {
  id = 'no-op';
  async execute(op: ShadowOperation, _state: FileState): Promise<MergeResult> {
    return {
      path: op.path,
      success: true,
      mergedContent: undefined,
      isConflict: false,
      workerId: 'no-op',
      executionTime: 0,
    };
  }
}
