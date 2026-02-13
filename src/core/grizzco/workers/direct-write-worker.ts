import { FileState, MergeResult, OpType, ShadowOperation } from '../domain/grizzco-types.js';

import { IMergeWorker } from './i-merge-worker.js';

/**
 * Direct Write Worker
 * Use case: Clean files, Untracked files (New files)
 */
export class DirectWriteWorker implements IMergeWorker {
  readonly id = 'direct-write';

  async execute(op: ShadowOperation, state: FileState): Promise<MergeResult> {
    const startTime = Date.now();

    if (!op.content && op.type !== OpType.DELETE) {
      // Delete operations might not have content, but modify/create must
      // However, ShadowOperation structure usually has content for create/modify
      return {
        path: state.path,
        success: false,
        error: 'Operation missing content',
        isConflict: false,
        workerId: this.id,
        executionTime: Date.now() - startTime,
      };
    }

    // For delete operations, we don't strictly need content, but the merged content is technically empty/null
    // logic handling is done in AtomicFileWriter, but here we prepare the result.
    // If it's a delete, mergedContent should be undefined or empty?
    // The AtomicFileWriter checks op.type.
    // But TransactionStrategy calls executeMerge first.
    // If op.type === 'delete', executeMerge might just pass.

    // Actually, looking at TransactionStrategy in plan:
    // .writeAtomic() handles delete logic separate from .executeMerge().
    // But .executeMerge() is expected to produce mergedContent for write.
    // If delete, maybe we return success with no content?

    // Let's assume this worker is mainly for Create/Modify on clean files.
    // If it's delete, it might be handled here too if needed, but let's stick to the plan's DirectWrite logic which returns op.content.

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
