import { randomBytes } from 'crypto';

import { LIMITS } from '../config/limits.js';
import type { ResolvedConfig } from '../config/types.js';
import { createFlowEventAdapter } from '../grizzco/engine/observability/event-adapter.js';
import { LoopTelemetry } from '../grizzco/engine/observability/loop-telemetry.js';
import { buildLoopFailureResult } from '../grizzco/engine/outcome/loop-result-mapper.js';
import { buildFlowTransactionRunner } from '../grizzco/engine/transaction/runner-builder.js';
import { runFlowSession } from '../grizzco/engine/transaction/session.js';
import { HostRunner } from '../grizzco/runtime/host/host-runner.js';
import { sanitizeError } from '../llm/errors.js';
import {
  clearAuditTrail,
  recordAuditEvent,
  setAuditContext,
} from '../observability/audit-trail.js';
import { extractErrorCode, REDACTED_ERROR_TOKEN } from '../observability/error-envelope.js';
import { Phase, type FlowMode, type LoopOptions, type LoopResult } from '../types/index.js';

import { finalizeLoopRun } from './loop-finalize.js';
import { resolveAndApplyRuntimeConfig } from './loop-runtime-config.js';
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
    clearAuditTrail();
    const correlationId = `run-${randomBytes(4).toString('hex')}`;
    setAuditContext({
      correlationId,
      scope: 'session',
      sessionId: options.langfuseSessionId,
      userId: options.langfuseUserId,
    });

    const now = () => new Date();
    const telemetry = new LoopTelemetry(now);
    const { emitSanitized, emitFlow } = createFlowEventAdapter({
      onEvent: options.onEvent,
      telemetry,
    });

    const hostRunner = new HostRunner(options, emitSanitized, now);
    let latestAuditPath: string | undefined;
    const shadowTaskId = randomBytes(4).toString('hex');
    let finalResult: LoopResult | undefined;
    const runMode = 'run' as const;

    emitSanitized({ type: 'run.start', mode: runMode, timestamp: now() });
    recordAuditEvent('run.start', { mode: runMode }, { scope: 'session', severity: 'low' });

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
      finalResult = sessionResult.result;
      emitSanitized({
        type: 'run.end',
        mode: runMode,
        success: Boolean(finalResult.success),
        timestamp: now(),
      });
      recordAuditEvent(
        'run.end',
        { mode: runMode, success: Boolean(finalResult.success) },
        { scope: 'session', severity: finalResult.success ? 'low' : 'medium' },
      );
      return finalResult;
    } catch (error) {
      const extractedCode = extractErrorCode(error);
      const errorCode = extractedCode && extractedCode !== 'Error' ? extractedCode : undefined;
      const message = sanitizeError(error);
      const safeMeta =
        error &&
        typeof error === 'object' &&
        'safeMeta' in error &&
        (error as { safeMeta?: unknown }).safeMeta &&
        typeof (error as { safeMeta?: unknown }).safeMeta === 'object'
          ? ((error as { safeMeta: Record<string, unknown> }).safeMeta as Record<string, unknown>)
          : undefined;
      recordAuditEvent(
        'run.failed.diagnostic',
        {
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode,
          phase: Phase.PREFLIGHT,
          source: 'runtime.loop.catch',
          redacted: message === REDACTED_ERROR_TOKEN,
          safeMeta,
        },
        { source: 'runtime', severity: 'high', scope: 'session', phase: Phase.PREFLIGHT },
      );
      telemetry.recordLog(Phase.PREFLIGHT, message, false);
      emitSanitized({ type: 'log', level: 'error', message, timestamp: now() });
      const fallbackFlowMode: FlowMode = options.mode ?? 'patch';
      finalResult = buildLoopFailureResult({
        message,
        flowMode: fallbackFlowMode,
        telemetry,
        auditPath: latestAuditPath,
        reasonCode: 'LOOP_FAILED',
        failurePhase: Phase.PREFLIGHT,
        errorCode,
      });
      emitSanitized({ type: 'run.end', mode: runMode, success: false, timestamp: now() });
      recordAuditEvent(
        'run.end',
        { mode: runMode, success: false },
        { scope: 'session', severity: 'high', phase: Phase.PREFLIGHT },
      );
      return finalResult;
    } finally {
      const finalized = await finalizeLoopRun({
        config: this.config,
        options,
        hostRunner,
        correlationId,
        latestAuditPath,
        finalResult,
      });
      latestAuditPath = finalized.latestAuditPath;
      finalResult = finalized.finalResult;
    }
  }
}
