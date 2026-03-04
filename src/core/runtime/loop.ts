import { randomBytes } from 'crypto';

import { text } from '../../locales/index.js';
import { LIMITS } from '../config/limits.js';
import { resolveConfig } from '../config/resolve.js';
import type { ResolvedConfig } from '../config/types.js';
import { getGlobalAdjuster, resetGlobalAdjuster } from '../context/budget/dynamic-adjuster.js';
import {
  initializeDefaultCalculator,
  setDefaultModel,
  setUseTokenBudget,
} from '../context/policies/pack-until-full.js';
import { createFlowEventAdapter } from '../grizzco/engine/observability/event-adapter.js';
import { LoopTelemetry } from '../grizzco/engine/observability/loop-telemetry.js';
import { buildLoopFailureResult } from '../grizzco/engine/outcome/loop-result-mapper.js';
import { buildFlowTransactionRunner } from '../grizzco/engine/transaction/runner-builder.js';
import { runFlowSession } from '../grizzco/engine/transaction/session.js';
import { HostRunner } from '../grizzco/runtime/host/host-runner.js';
import { sanitizeError } from '../llm/errors.js';
import { appendAuditTrailToAuditFile } from '../observability/audit-file.js';
import {
  clearAuditContext,
  clearAuditTrail,
  drainAuditDropStats,
  recordAuditEvent,
  setAuditBufferLimits,
  setAuditContext,
} from '../observability/audit-trail.js';
import { extractErrorCode, REDACTED_ERROR_TOKEN } from '../observability/error-envelope.js';
import { logger } from '../observability/logger.js';
import { buildRunOutcomeReport } from '../observability/run-outcome-reporter.js';
import { drainRedactionMetrics, setRedactionConfig } from '../security/redaction.js';
import { Phase, type FlowMode, type LoopOptions, type LoopResult } from '../types/index.js';

import { Semaphore } from './semaphore.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

export async function runSalmonLoop(options: LoopOptions): Promise<LoopResult> {
  return globalSemaphore.run(async () => {
    // Load config for token budget settings
    const config = await resolveConfig({
      repoRoot: options.repoPath,
    });
    setUseTokenBudget(config.context.useTokenBudget);
    setAuditBufferLimits(config.observability.audit.buffer);
    setRedactionConfig(config.security.redaction);

    // Set model for adaptive budget (if available)
    const modelId = config.llm.models.selectedModelId;
    if (modelId) {
      setDefaultModel(modelId);
    }

    // Initialize token calculator on first run
    await initializeDefaultCalculator().catch(() => {
      // Silently fallback to char-based if initialization fails
    });

    // Initialize dynamic budget adjuster with config
    resetGlobalAdjuster(); // Reset for new session
    if (config.context.dynamicBudget.enabled) {
      getGlobalAdjuster(config.context.dynamicBudget);
    }

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
      try {
        await hostRunner.teardown();
      } finally {
        if (options.outcomeReporter && finalResult) {
          try {
            await options.outcomeReporter.report(buildRunOutcomeReport(finalResult), {
              runId: correlationId,
              auditPath: latestAuditPath,
              mode: options.mode,
              repoPath: options.repoPath,
              sessionId: options.langfuseSessionId,
              userId: options.langfuseUserId,
              instruction: options.instruction,
              verify: options.verify,
            });
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(text.grizzco.observability.outcomeReporterFailed(msg));
          }
        }
        const redactionStats = drainRedactionMetrics();
        if (redactionStats.count > 0) {
          recordAuditEvent(
            'context.redaction.count',
            { count: redactionStats.count },
            { source: 'security', severity: 'low', scope: 'session' },
          );
        }
        const dropStats = drainAuditDropStats();
        if (dropStats.count > 0) {
          recordAuditEvent(
            'audit.dropped',
            { count: dropStats.count, since: dropStats.since },
            { source: 'audit', severity: 'medium', scope: 'session' },
          );
          const warnThreshold = this.config.observability.audit.buffer.droppedWarn;
          if (dropStats.count >= warnThreshold) {
            logger.warn(
              `Audit buffer dropped ${dropStats.count} events (threshold=${warnThreshold}).`,
            );
            recordAuditEvent(
              'audit.dropped.warn',
              { count: dropStats.count, since: dropStats.since, threshold: warnThreshold },
              { source: 'audit', severity: 'high', scope: 'session' },
            );
          }
        }
        // Append at the end so any audit events emitted by the outcomeReporter are persisted too.
        const fallbackFailureReason =
          finalResult && !finalResult.success ? finalResult.reason : undefined;
        const appendedPath = await appendAuditTrailToAuditFile({
          auditPath: latestAuditPath,
          repoPath: options.repoPath,
          auditScope: options.auditScope,
          failureReason: fallbackFailureReason,
          runId: correlationId,
          finalOutcome: finalResult
            ? {
                success: finalResult.success,
                reasonCode: finalResult.reasonCode,
                failurePhase: finalResult.failurePhase,
                errorCode: finalResult.errorCode,
              }
            : undefined,
        });
        if (!latestAuditPath && appendedPath) {
          latestAuditPath = appendedPath;
          if (finalResult) finalResult.auditPath = appendedPath;
        }
        clearAuditContext();
      }
    }
  }
}
