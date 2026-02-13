import { randomBytes } from 'crypto';

import { LIMITS } from './config/limits.js';
import { createFlowEventAdapter } from './grizzco/engine/observability/event-adapter.js';
import { LoopTelemetry } from './grizzco/engine/observability/loop-telemetry.js';
import { buildLoopFailureResult } from './grizzco/engine/outcome/loop-result-mapper.js';
import { buildFlowTransactionRunner } from './grizzco/engine/transaction/runner-builder.js';
import { runFlowSession } from './grizzco/engine/transaction/session.js';
import { HostRunner } from './grizzco/runtime/host/host-runner.js';
import { sanitizeError } from './llm/errors.js';
import { appendAuditTrailToAuditFile } from './observability/audit-file.js';
import {
  clearAuditContext,
  clearAuditTrail,
  setAuditContext,
} from './observability/audit-trail.js';
import { Semaphore } from './runtime/semaphore.js';
import { Phase } from './types.js';
import type { FlowMode, LoopOptions, LoopResult } from './types.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

export async function runSalmonLoop(options: LoopOptions): Promise<LoopResult> {
  return globalSemaphore.run(async () => {
    const loop = new SalmonLoop();
    return loop.run(options);
  });
}

export class SalmonLoop {
  async run(options: LoopOptions): Promise<LoopResult> {
    clearAuditTrail();
    const correlationId = `run-${randomBytes(4).toString('hex')}`;
    setAuditContext({ correlationId, scope: 'session' });

    const now = () => new Date();
    const telemetry = new LoopTelemetry(now);
    const { emitSanitized, emitFlow } = createFlowEventAdapter({
      onEvent: options.onEvent,
      telemetry,
    });

    const hostRunner = new HostRunner(options, emitSanitized, now);
    let latestAuditPath: string | undefined;
    const shadowTaskId = randomBytes(4).toString('hex');

    try {
      const hostContext = await hostRunner.boot();
      const runner = buildFlowTransactionRunner({
        flowMode: hostContext.flowMode,
        fsAdapter: hostContext.fsAdapter,
        env: hostContext.env,
        activeRepoPath: hostContext.activeRepoPath,
        planRuntime: hostContext.planRuntime,
        options,
        emitFlow,
        now,
        telemetry,
        shadowTaskId,
      });
      const { flowMode } = hostContext;

      const sessionResult = await runFlowSession({
        runner,
        flowMode,
        options,
        telemetry,
        now,
        emitSanitized,
        auditPath: latestAuditPath,
      });
      latestAuditPath = sessionResult.auditPath;
      return sessionResult.result;
    } catch (error) {
      const message = sanitizeError(error);
      telemetry.recordLog(Phase.PREFLIGHT, message, false);
      emitSanitized({ type: 'log', level: 'error', message, timestamp: now() });
      const fallbackFlowMode: FlowMode = options.mode ?? 'patch';
      return buildLoopFailureResult({
        message,
        flowMode: fallbackFlowMode,
        telemetry,
        auditPath: latestAuditPath,
        reasonCode: 'LOOP_FAILED',
        failurePhase: Phase.PREFLIGHT,
      });
    } finally {
      try {
        await hostRunner.teardown();
      } finally {
        await appendAuditTrailToAuditFile(latestAuditPath);
        clearAuditContext();
      }
    }
  }
}
