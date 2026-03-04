import { LIMITS } from '../config/limits.js';
import type { ResolvedConfig } from '../config/types.js';
import { Phase, type LoopOptions, type LoopResult } from '../types/runtime.js';

import { finalizeLoopRun } from './loop-finalize.js';
import {
  buildLoopFailureFromError,
  initializeLoopLifecycle,
  recordLoopRunEnd,
  recordLoopRunStart,
} from './loop-run-lifecycle.js';
import { resolveAndApplyRuntimeConfig } from './loop-runtime-config.js';
import { executeLoopSession } from './loop-session-runner.js';
import { Semaphore } from './semaphore.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

export async function runSalmonLoop(options: LoopOptions): Promise<LoopResult> {
  return globalSemaphore.run(async () => {
    const config = await resolveAndApplyRuntimeConfig(options);

    const loop = new SalmonLoop(config);
    return loop.run(options);
  });
}

export class SalmonLoop {
  constructor(private readonly config: ResolvedConfig) {}

  async run(options: LoopOptions): Promise<LoopResult> {
    const lifecycle = initializeLoopLifecycle(options);
    let latestAuditPath: string | undefined;
    let finalResult: LoopResult | undefined;
    recordLoopRunStart({
      emitSanitized: lifecycle.emitSanitized,
      runMode: lifecycle.runMode,
      now: lifecycle.now,
    });

    try {
      const sessionResult = await executeLoopSession({
        options,
        lifecycle,
        latestAuditPath,
      });
      latestAuditPath = sessionResult.auditPath;
      finalResult = sessionResult.result;
      recordLoopRunEnd({
        emitSanitized: lifecycle.emitSanitized,
        runMode: lifecycle.runMode,
        success: Boolean(finalResult.success),
        now: lifecycle.now,
      });
      return finalResult;
    } catch (error) {
      finalResult = buildLoopFailureFromError({
        error,
        options,
        telemetry: lifecycle.telemetry,
        emitSanitized: lifecycle.emitSanitized,
        now: lifecycle.now,
        latestAuditPath,
      });
      recordLoopRunEnd({
        emitSanitized: lifecycle.emitSanitized,
        runMode: lifecycle.runMode,
        success: false,
        now: lifecycle.now,
        auditMeta: { severity: 'high', phase: Phase.PREFLIGHT },
      });
      return finalResult;
    } finally {
      const finalized = await finalizeLoopRun({
        config: this.config,
        options,
        hostRunner: lifecycle.hostRunner,
        correlationId: lifecycle.correlationId,
        latestAuditPath,
        finalResult,
      });
      latestAuditPath = finalized.latestAuditPath;
      finalResult = finalized.finalResult;
    }
  }
}
