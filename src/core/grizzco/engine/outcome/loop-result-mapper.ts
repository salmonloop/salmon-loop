import { text } from '../../../../locales/index.js';
import { getBudgetRunSummary } from '../../../context/budget/integration.js';
import { getAuthorizationDecisionsFromAuditTrail } from '../../../observability/authorization-decisions.js';
import { getTokenUsageFromAuditTrail } from '../../../observability/token-usage.js';
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
  const contextHash =
    (ctx as { contextResult?: { meta?: { contextHash?: string } } } | undefined)?.contextResult
      ?.meta?.contextHash ?? ctx?.context?.contextHash;
  const verifyArtifact = ctx?.verifyArtifact ?? executionReport.lastVerifyArtifact;

  const authorizationDecisions = (() => {
    if (!options.eventPayload?.includeAuthorizationDecisions) return undefined;
    const decisions = getAuthorizationDecisionsFromAuditTrail();
    return decisions.length > 0 ? decisions : undefined;
  })();

  if (executionReport.success) {
    const attempts = executionReport.attempts;
    const usage = getTokenUsageFromAuditTrail() ?? undefined;
    const budgetSummary = getBudgetRunSummary() ?? undefined;
    if (options.dryRun || flowMode === 'review') {
      return {
        success: true,
        reason: text.loop.operationCompleted,
        reasonCode: options.dryRun ? 'DRY_RUN' : 'SUCCESS',
        attempts,
        contextHash,
        logs: telemetry.getLogs(),
        usage,
        authorizationDecisions,
        history: telemetry.getHistory(),
        finalPatch: ctx?.diff,
        changedFiles: ctx?.changedFiles,
        auditPath,
        verifyArtifact,
        authorizationSummary: executionReport.authorizationSummary || undefined,
        strategyName: executionReport.flowReport.strategyName ?? flowMode,
        fsMode: executionReport.flowReport.fsMode ?? flowMode,
        budgetSummary,
      };
    }

    return {
      success: true,
      reason: text.loop.operationCompleted,
      reasonCode: 'SUCCESS',
      attempts,
      contextHash,
      logs: telemetry.getLogs(),
      usage,
      authorizationDecisions,
      history: telemetry.getHistory(),
      finalPatch: ctx?.diff,
      changedFiles: ctx?.changedFiles,
      auditPath,
      verifyArtifact,
      authorizationSummary: executionReport.authorizationSummary || undefined,
      strategyName: executionReport.flowReport.strategyName ?? flowMode,
      fsMode: executionReport.flowReport.fsMode ?? flowMode,
      budgetSummary,
    };
  }

  const retryFailureReason = executionReport.history.at(-1)?.error ?? text.loop.loopExecutionFailed;
  const failureReason =
    executionReport.terminalReason ||
    (executionReport.retryExhausted ? text.loop.exceededMaxRetriesSimple : retryFailureReason);
  const safeHint =
    executionReport.terminalSafeHint ||
    (executionReport.retryExhausted
      ? text.loop.exceededMaxRetriesSimple
      : executionReport.terminalReason || failureReason);
  const remediationSteps = executionReport.terminalRemediationSteps ?? [];
  const reasonCode =
    executionReport.terminalReasonCode ||
    (executionReport.retryExhausted ? 'MAX_RETRIES' : 'LOOP_FAILED');
  const failurePhase =
    executionReport.terminalFailurePhase ||
    (executionReport.retryExhausted ? Phase.VERIFY : undefined);

  const usage = getTokenUsageFromAuditTrail() ?? undefined;
  const budgetSummary = getBudgetRunSummary() ?? undefined;
  return {
    success: false,
    reason: safeHint,
    reasonCode,
    diagnosticCode: executionReport.terminalDiagnosticCode ?? reasonCode,
    safeHint,
    remediationSteps,
    attempts: executionReport.attempts,
    contextHash,
    logs: telemetry.getLogs(),
    usage,
    authorizationDecisions,
    history: telemetry.getHistory(),
    failurePhase,
    errorType: ErrorType.UNKNOWN,
    errorCode: executionReport.lastErrorCode,
    auditPath,
    verifyArtifact,
    authorizationSummary: executionReport.authorizationSummary || undefined,
    strategyName: executionReport.flowReport.strategyName ?? flowMode,
    fsMode: executionReport.flowReport.fsMode ?? flowMode,
    budgetSummary,
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
  const usage = getTokenUsageFromAuditTrail() ?? undefined;
  const budgetSummary = getBudgetRunSummary() ?? undefined;
  const authorizationDecisions = (() => {
    const decisions = getAuthorizationDecisionsFromAuditTrail();
    return decisions.length > 0 ? decisions : undefined;
  })();
  return {
    success: false,
    reason: message,
    reasonCode,
    diagnosticCode: reasonCode,
    safeHint: message,
    remediationSteps: [],
    attempts: 0,
    logs: telemetry.getLogs(),
    usage,
    authorizationDecisions,
    history: telemetry.getHistory(),
    failurePhase,
    errorType: ErrorType.UNKNOWN,
    auditPath,
    strategyName: flowMode,
    fsMode: flowMode,
    budgetSummary,
  };
}
