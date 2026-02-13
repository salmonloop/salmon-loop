import { randomBytes } from 'crypto';

import { text } from '../locales/index.js';

import { GitAdapter } from './adapters/git/git-adapter.js';
import { appendAuditTrailToAuditFile } from './audit-file.js';
import { clearAuditContext, clearAuditTrail, setAuditContext } from './audit-trail.js';
import { Semaphore } from './concurrency.js';
import type { ShrinkCtx } from './grizzco/types.js';
import { LIMITS } from './limits.js';
import { sanitizeError } from './llm/errors.js';
import {
  LoopExecutionCoordinator,
  OperationCancelledError,
} from './loop/loop-execution-coordinator.js';
import { LoopTelemetry } from './loop/loop-telemetry.js';
import { HostRunner } from './orchestration/host-runner.js';
import type { HostBootContext } from './orchestration/types.js';
import { FileStateResolver } from './strata/layers/file-state-resolver.js';
import { WorkspaceSynchronizer } from './strata/runtime/synchronizer.js';
import { ErrorType, Phase } from './types.js';
import type { ExecutionPhase, LoopEvent, LoopOptions, LoopResult } from './types.js';

const globalSemaphore = new Semaphore(LIMITS.maxConcurrentOperations);

function sanitizeLogEvent(event: LoopEvent): LoopEvent {
  if (event.type === 'log' && event.level === 'error') {
    return { ...event, message: sanitizeError(event.message) };
  }
  return event;
}

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
    let currentPhase: ExecutionPhase | 'UNKNOWN' = 'UNKNOWN';

    const emitToClient = (event: LoopEvent) => options.onEvent?.(event);

    const emitSanitized = (event: LoopEvent) => {
      const sanitizedEvent = sanitizeLogEvent(event);
      emitToClient(sanitizedEvent);
      if (sanitizedEvent.type === 'log') {
        telemetry.recordLog('PREFLIGHT', sanitizedEvent.message, sanitizedEvent.level !== 'error');
      }
    };

    const emitLoop = (event: LoopEvent) => {
      const sanitizedEvent = sanitizeLogEvent(event);
      if (sanitizedEvent.type === 'phase.start') {
        currentPhase = sanitizedEvent.phase;
      } else if (sanitizedEvent.type === 'phase.end') {
        currentPhase = 'UNKNOWN';
      }
      if (sanitizedEvent.type === 'log') {
        telemetry.recordLog(currentPhase, sanitizedEvent.message, sanitizedEvent.level !== 'error');
      }
      emitSanitized(sanitizedEvent);
    };

    const hostRunner = new HostRunner(options, emitSanitized, now);
    let hostContext: HostBootContext | undefined;
    let latestAuditPath: string | undefined;
    const shadowTaskId = randomBytes(4).toString('hex');

    try {
      hostContext = await hostRunner.boot();

      const { env, flowMode, fsAdapter, activeRepoPath, planRuntime } = hostContext;
      const checkpointManager = env.checkpointManager;
      const synchronizer = new WorkspaceSynchronizer(checkpointManager);
      const git = new GitAdapter(activeRepoPath);
      const resolver = new FileStateResolver(git, activeRepoPath);
      const coordinator = new LoopExecutionCoordinator({
        options,
        flowMode,
        emit: emitLoop,
        now,
        fsAdapter,
        env,
        synchronizer,
        shadowTaskId,
        planRuntime,
        fileStateResolver: resolver,
        telemetry,
      });

      try {
        const executionReport = await coordinator.execute();
        latestAuditPath = executionReport.flowReport.auditPath ?? latestAuditPath;
        const ctx =
          executionReport.lastContext ??
          (executionReport.flowReport.data as Partial<ShrinkCtx> | undefined);
        const verifyArtifact = ctx?.verifyArtifact ?? executionReport.lastVerifyArtifact;

        if (executionReport.success) {
          const attempts = executionReport.attempts;
          if (options.dryRun || flowMode === 'review') {
            return {
              success: true,
              reason: text.loop.operationCompleted,
              reasonCode: options.dryRun ? 'DRY_RUN' : 'SUCCESS',
              attempts,
              logs: telemetry.getLogs(),
              history: telemetry.getHistory(),
              finalPatch: ctx?.diff,
              changedFiles: ctx?.changedFiles,
              auditPath: latestAuditPath,
              verifyArtifact,
              authorizationSummary: executionReport.authorizationSummary || undefined,
              strategyName: executionReport.flowReport.strategyName ?? flowMode,
              fsMode: executionReport.flowReport.fsMode ?? flowMode,
            };
          }

          return {
            success: true,
            reason: text.loop.operationCompleted,
            reasonCode: 'SUCCESS',
            attempts,
            logs: telemetry.getLogs(),
            history: telemetry.getHistory(),
            finalPatch: ctx?.diff,
            changedFiles: ctx?.changedFiles,
            auditPath: latestAuditPath,
            verifyArtifact,
            authorizationSummary: executionReport.authorizationSummary || undefined,
            strategyName: executionReport.flowReport.strategyName ?? flowMode,
            fsMode: executionReport.flowReport.fsMode ?? flowMode,
          };
        }

        const retryFailureReason =
          executionReport.history.at(-1)?.error ?? text.loop.loopExecutionFailed;
        const failureReason =
          executionReport.terminalReason ||
          (executionReport.retryExhausted
            ? text.loop.exceededMaxRetriesSimple
            : retryFailureReason);
        const reasonCode =
          executionReport.terminalReasonCode ||
          (executionReport.retryExhausted ? 'MAX_RETRIES' : 'LOOP_CRASH');
        const failurePhase =
          executionReport.terminalFailurePhase ||
          (executionReport.retryExhausted ? Phase.VERIFY : undefined);

        return {
          success: false,
          reason: failureReason,
          reasonCode,
          attempts: executionReport.attempts,
          logs: telemetry.getLogs(),
          history: telemetry.getHistory(),
          failurePhase,
          errorType: ErrorType.UNKNOWN,
          errorCode: executionReport.lastErrorCode,
          auditPath: latestAuditPath,
          verifyArtifact,
          authorizationSummary: executionReport.authorizationSummary || undefined,
          strategyName: executionReport.flowReport.strategyName ?? flowMode,
          fsMode: executionReport.flowReport.fsMode ?? flowMode,
        };
      } catch (error) {
        if (error instanceof OperationCancelledError) {
          const message = error.message;
          telemetry.recordLog('error', message, false);
          emitSanitized({ type: 'log', level: 'error', message, timestamp: now() });
          return {
            success: false,
            reason: message,
            reasonCode: 'LOOP_CRASH',
            attempts: 0,
            logs: telemetry.getLogs(),
            history: telemetry.getHistory(),
            errorType: ErrorType.UNKNOWN,
            auditPath: latestAuditPath,
            strategyName: flowMode,
            fsMode: flowMode,
          };
        }

        const message = sanitizeError(error);
        telemetry.recordLog('error', message, false);
        emitSanitized({ type: 'log', level: 'error', message, timestamp: now() });
        return {
          success: false,
          reason: message,
          reasonCode: 'LOOP_CRASH',
          attempts: 0,
          logs: telemetry.getLogs(),
          history: telemetry.getHistory(),
          failurePhase: Phase.VERIFY,
          errorType: ErrorType.UNKNOWN,
          auditPath: latestAuditPath,
          strategyName: flowMode,
          fsMode: flowMode,
        };
      }
    } catch (error) {
      const message = sanitizeError(error);
      telemetry.recordLog(Phase.PREFLIGHT, message, false);
      emitSanitized({ type: 'log', level: 'error', message, timestamp: now() });
      return {
        success: false,
        reason: message,
        reasonCode: 'LOOP_FAILED',
        attempts: 0,
        logs: telemetry.getLogs(),
        history: telemetry.getHistory(),
        failurePhase: Phase.PREFLIGHT,
        errorType: ErrorType.UNKNOWN,
        auditPath: latestAuditPath,
        strategyName: options.mode ?? 'patch',
        fsMode: options.mode ?? 'patch',
      };
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
