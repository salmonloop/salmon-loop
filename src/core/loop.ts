import { randomBytes } from 'crypto';

import { appendAuditTrailToAuditFile } from './audit-file.js';
import { clearAuditContext, clearAuditTrail, setAuditContext } from './audit-trail.js';
import { Semaphore } from './concurrency.js';
import { createFlowEventAdapter } from './grizzco/flows/flow-event-adapter.js';
import { buildLoopFailureResult } from './grizzco/flows/flow-result-factory.js';
import { buildFlowTransactionRunner } from './grizzco/flows/flow-runner-builder.js';
import { runFlowSession } from './grizzco/flows/flow-session.js';
import { LoopTelemetry } from './grizzco/flows/flow-telemetry.js';
import { LIMITS } from './limits.js';
import { sanitizeError } from './llm/errors.js';
import { HostRunner } from './orchestration/host-runner.js';
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
