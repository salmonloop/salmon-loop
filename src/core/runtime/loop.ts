import { randomBytes } from 'crypto';

import { text } from '../../locales/index.js';
import { LIMITS } from '../config/limits.js';
import { resolveConfig } from '../config/resolve.js';
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
  setAuditContext,
} from '../observability/audit-trail.js';
import { logger } from '../observability/logger.js';
import { buildRunOutcomeReport } from '../observability/run-outcome-reporter.js';
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

    // Set model for adaptive budget (if available)
    const modelId = config.llm.models.selectedModelId;
    if (modelId) {
      setDefaultModel(modelId);
    }

    // Initialize token calculator on first run
    await initializeDefaultCalculator().catch(() => {
      // Silently fallback to char-based if initialization fails
    });

    const loop = new SalmonLoop();
    return loop.run(options);
  });
}

export class SalmonLoop {
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
      return finalResult;
    } catch (error) {
      const message = sanitizeError(error);
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
      });
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
        // Append at the end so any audit events emitted by the outcomeReporter are persisted too.
        await appendAuditTrailToAuditFile(latestAuditPath);
        clearAuditContext();
      }
    }
  }
}
