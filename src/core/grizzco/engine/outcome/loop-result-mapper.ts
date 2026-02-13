import { text } from '../../../../locales/index.js';
import { ErrorType, Phase } from '../../../types/index.js';
import type { ExecutionPhase, FlowMode, LoopOptions, LoopResult } from '../../../types/index.js';
import type { LoopTelemetry } from '../observability/loop-telemetry.js';
import type { ShrinkCtx } from '../pipeline/types.js';
import type { FlowTransactionReport } from '../transaction/types.js';

interface BuildLoopResultParams {
  executionReport: FlowTransactionReport;
  flowMode: FlowMode;
  options: LoopOptions;
  telemetry: LoopTelemetry;
  auditPath?: string;
}

interface BuildLoopCrashParams {
  message: string;
  flowMode: FlowMode;
  telemetry: LoopTelemetry;
  auditPath?: string;
  reasonCode: 'LOOP_CRASH' | 'LOOP_FAILED';
  failurePhase?: ExecutionPhase;
}

export function buildLoopResultFromTransaction({
  executionReport,
  flowMode,
  options,
  telemetry,
  auditPath,
}: BuildLoopResultParams): LoopResult {
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
        auditPath,
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
      auditPath,
      verifyArtifact,
      authorizationSummary: executionReport.authorizationSummary || undefined,
      strategyName: executionReport.flowReport.strategyName ?? flowMode,
      fsMode: executionReport.flowReport.fsMode ?? flowMode,
    };
  }

  const retryFailureReason = executionReport.history.at(-1)?.error ?? text.loop.loopExecutionFailed;
  const failureReason =
    executionReport.terminalReason ||
    (executionReport.retryExhausted ? text.loop.exceededMaxRetriesSimple : retryFailureReason);
  const reasonCode =
    executionReport.terminalReasonCode ||
    (executionReport.retryExhausted ? 'MAX_RETRIES' : 'LOOP_FAILED');
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
    auditPath,
    verifyArtifact,
    authorizationSummary: executionReport.authorizationSummary || undefined,
    strategyName: executionReport.flowReport.strategyName ?? flowMode,
    fsMode: executionReport.flowReport.fsMode ?? flowMode,
  };
}

export function buildLoopFailureResult({
  message,
  flowMode,
  telemetry,
  auditPath,
  reasonCode,
  failurePhase,
}: BuildLoopCrashParams): LoopResult {
  return {
    success: false,
    reason: message,
    reasonCode,
    attempts: 0,
    logs: telemetry.getLogs(),
    history: telemetry.getHistory(),
    failurePhase,
    errorType: ErrorType.UNKNOWN,
    auditPath,
    strategyName: flowMode,
    fsMode: flowMode,
  };
}
