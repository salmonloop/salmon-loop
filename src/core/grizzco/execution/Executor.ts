import * as path from 'path';

import { text } from '../../../locales/index.js';
import { AtomicFileWriter } from '../../adapters/fs/atomic-file-writer.js';
import { logger } from '../../logger.js';
import { DslContext, ExecutionPlan } from '../dsl/DecisionEngine.js';

import { RejectionManager } from './RejectionManager.js';
import { WorkerFactory } from './WorkerFactory.js';

export interface ExecutionResult {
  success: boolean;
  error?: string;
  actionTaken: string;
}

export class Executor {
  private writer = new AtomicFileWriter();
  private rejectionMgr: RejectionManager;

  constructor(
    private workerFactory: WorkerFactory,
    rejectDir: string = '.salmonloop/runtime/rejections',
  ) {
    this.rejectionMgr = new RejectionManager(rejectDir);
  }

  async execute(plan: ExecutionPlan, ctx: DslContext): Promise<ExecutionResult> {
    const { file, operation } = ctx;

    // 1. Handle Abort
    if (plan.shouldAbort) {
      await this.rejectionMgr.create(
        file.path,
        plan.abortReason || text.grizzco.errors.aborted,
        ctx,
      );
      return { success: false, error: plan.abortReason, actionTaken: 'ABORT' };
    }

    // 2. Select Worker
    if (!plan.workerId) {
      return {
        success: false,
        error: text.grizzco.errors.noWorkerSelected,
        actionTaken: 'ERROR',
      };
    }

    try {
      const worker = this.workerFactory.get(plan.workerId);
      logger.debug(`[Executor] Executing worker ${plan.workerId} for ${file.path}`);

      // 3. Execute Worker
      const result = await worker.execute(operation, file, {
        snapshotId: ctx.snapshot.id,
        repoRoot: ctx.repoRoot,
      });

      if (!result.success) {
        await this.rejectionMgr.create(
          file.path,
          result.error || text.grizzco.errors.mergeFailed('unknown'),
          ctx,
        );
        return { success: false, error: result.error, actionTaken: 'WORKER_FAILURE' };
      }

      // 4. Atomic Write
      if (result.mergedContent && !ctx.options.dryRun) {
        const absolutePath = ctx.repoRoot ? path.join(ctx.repoRoot, file.path) : file.path;
        await this.writer.writeAtomic(absolutePath, result.mergedContent);
      } else if (result.mergedContent && ctx.options.dryRun) {
        logger.info(`[DryRun] Would write ${file.path}`);
      }

      return { success: true, actionTaken: `MERGE(${plan.workerId})` };
    } catch (error: any) {
      const msg = text.grizzco.errors.unexpectedException(error.message);
      await this.rejectionMgr.create(file.path, msg, ctx);
      return { success: false, error: msg, actionTaken: 'EXCEPTION' };
    }
  }
}
