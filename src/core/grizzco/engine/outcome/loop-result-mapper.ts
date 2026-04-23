import { text } from '../../../../locales/index.js';
import { getBudgetRunSummary } from '../../../context/budget/integration.js';
import { getAuthorizationDecisionsFromAuditTrail } from '../../../observability/authorization-decisions.js';
import { buildFailureEnvelope } from '../../../observability/error-envelope.js';
import { getTokenUsageFromAuditTrail } from '../../../observability/token-usage.js';
import { resolveExecutionProfile } from '../../../runtime/execution-profile.js';
import type { RootCauseCode, TerminalReason } from '../../../types/loop.js';
import { ErrorType, Phase } from '../../../types/runtime.js';
import type { ExecutionPhase, FlowMode, LoopOptions, LoopResult } from '../../../types/runtime.js';
import type { LoopTelemetry } from '../observability/loop-telemetry.js';
import type { TerminalCtx } from '../pipeline/types.js';
import type { FlowTransactionReport } from '../transaction/types.js';

const ROOT_CAUSE_CODES: readonly RootCauseCode[] = [
  'LLM_RATE_LIMITED',
  'LLM_UPSTREAM_5XX',
  'LLM_NETWORK_UNREACHABLE',
  'LLM_REQUEST_TIMEOUT',
  'PLAN_OUTPUT_NOT_JSON',
  'PLAN_SCHEMA_INVALID',
  'STDOUT_CONTRACT_VIOLATION',
  'RESOURCE_LIMIT_CONFIRMED',
];

function toRootCauseCode(code: unknown): RootCauseCode | undefined {
  if (typeof code !== 'string') return undefined;
  return (ROOT_CAUSE_CODES as readonly string[]).includes(code)
    ? (code as RootCauseCode)
    : undefined;
}

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
  errorCode?: string;
}

export function buildLoopResultFromTransaction({
  executionReport,
  flowMode,
  options,
  telemetry,
  auditPath,
}: BuildLoopResultParams): LoopResult {
  const profile = resolveExecutionProfile(flowMode);
  const rootCause = toRootCauseCode(executionReport.lastErrorCode);
  const terminalReason: TerminalReason | undefined = executionReport.retryExhausted
    ? 'RETRY_BUDGET_EXHAUSTED'
    : executionReport.terminalReasonCode === 'AWAITING_INPUT'
      ? undefined
      : executionReport.success
        ? undefined
        : 'NON_RETRYABLE_FAILURE';

  const ctx =
    executionReport.lastContext ??
    (executionReport.flowReport.data as Partial<TerminalCtx> | undefined);
  const contextHash = (() => {
    const hashFromBudget = (ctx as any)?.contextResult?.meta?.contextHash;
    if (typeof hashFromBudget === 'string') return hashFromBudget;
    const hashFromContext =
      ctx && typeof ctx === 'object' && 'context' in ctx
        ? (ctx as any).context?.contextHash
        : undefined;
    return typeof hashFromContext === 'string' ? hashFromContext : undefined;
  })();
  const verifyArtifact =
    ctx && typeof ctx === 'object' && 'verifyArtifact' in ctx
      ? (ctx as any).verifyArtifact
      : executionReport.lastVerifyArtifact;
  const artifactHints = (() => {
    const hints = {
      verifyArtifact,
      subAgentPatchArtifacts: executionReport.lastSubAgentPatchArtifacts?.length
        ? executionReport.lastSubAgentPatchArtifacts
        : undefined,
      subAgentAuditArtifacts: executionReport.lastSubAgentAuditArtifacts?.length
        ? executionReport.lastSubAgentAuditArtifacts
        : undefined,
      recentReadArtifacts: executionReport.lastRecentReadArtifacts?.length
        ? executionReport.lastRecentReadArtifacts
        : undefined,
      toolResultPreviewArtifacts: executionReport.lastToolResultPreviewArtifacts?.length
        ? executionReport.lastToolResultPreviewArtifacts
        : undefined,
    };

    if (
      !hints.verifyArtifact &&
      !hints.subAgentPatchArtifacts &&
      !hints.subAgentAuditArtifacts &&
      !hints.recentReadArtifacts &&
      !hints.toolResultPreviewArtifacts
    ) {
      return undefined;
    }

    return hints;
  })();
  const assistantMessage =
    ((flowMode === 'answer' || profile.driver === 'agent') &&
    (ctx as any)?.report?.summary?.trim?.()
      ? String((ctx as any).report.summary).trim()
      : undefined) ?? undefined;
  const finalPatch =
    ctx && typeof ctx === 'object' && 'diff' in ctx ? (ctx as any).diff : undefined;
  const changedFiles =
    ctx && typeof ctx === 'object' && 'changedFiles' in ctx ? (ctx as any).changedFiles : undefined;

  const authorizationDecisions = (() => {
    if (!options.eventPayload?.includeAuthorizationDecisions) return undefined;
    const decisions = getAuthorizationDecisionsFromAuditTrail();
    return decisions.length > 0 ? decisions : undefined;
  })();

  if (executionReport.success) {
    const attempts = executionReport.attempts;
    const usage = getTokenUsageFromAuditTrail() ?? undefined;
    const budgetSummary = getBudgetRunSummary() ?? undefined;
    if (options.dryRun || profile.readOnly) {
      return {
        success: true,
        reason: text.loop.operationCompleted,
        reasonCode: options.dryRun ? 'DRY_RUN' : 'SUCCESS',
        terminalReason,
        attempts,
        contextHash,
        logs: telemetry.getLogs(),
        usage,
        authorizationDecisions,
        history: telemetry.getHistory(),
        finalPatch,
        changedFiles,
        assistantMessage,
        auditPath,
        verifyArtifact,
        artifactHints,
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
      terminalReason,
      attempts,
      contextHash,
      logs: telemetry.getLogs(),
      usage,
      authorizationDecisions,
      history: telemetry.getHistory(),
      finalPatch,
      changedFiles,
      assistantMessage,
      auditPath,
      verifyArtifact,
      artifactHints,
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
  const errorEnvelope = buildFailureEnvelope({
    code: executionReport.lastErrorCode,
    phase: failurePhase,
    safeHint,
    remediationSteps,
    fallbackMessage: failureReason,
  });
  return {
    success: false,
    reason: safeHint,
    reasonCode,
    terminalReason,
    rootCause,
    diagnosticCode: executionReport.terminalDiagnosticCode ?? reasonCode,
    safeHint,
    remediationSteps,
    errorEnvelope,
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
    artifactHints,
    authorizationSummary: executionReport.authorizationSummary || undefined,
    strategyName: executionReport.flowReport.strategyName ?? flowMode,
    fsMode: executionReport.flowReport.fsMode ?? flowMode,
    budgetSummary,
    inputRequired:
      executionReport.terminalReasonCode === 'AWAITING_INPUT'
        ? executionReport.terminalInputRequired
        : undefined,
  };
}

export function buildLoopFailureResult({
  message,
  flowMode,
  telemetry,
  auditPath,
  reasonCode,
  failurePhase,
  errorCode,
}: BuildLoopCrashParams): LoopResult {
  const usage = getTokenUsageFromAuditTrail() ?? undefined;
  const budgetSummary = getBudgetRunSummary() ?? undefined;
  const authorizationDecisions = (() => {
    const decisions = getAuthorizationDecisionsFromAuditTrail();
    return decisions.length > 0 ? decisions : undefined;
  })();
  const rootCause = toRootCauseCode(errorCode);
  const errorEnvelope = buildFailureEnvelope({
    phase: failurePhase,
    fallbackMessage: message,
  });
  return {
    success: false,
    reason: message,
    reasonCode,
    terminalReason: 'NON_RETRYABLE_FAILURE',
    rootCause,
    diagnosticCode: reasonCode,
    safeHint: message,
    remediationSteps: [],
    errorEnvelope,
    attempts: 0,
    logs: telemetry.getLogs(),
    usage,
    authorizationDecisions,
    history: telemetry.getHistory(),
    failurePhase,
    errorType: ErrorType.UNKNOWN,
    errorCode,
    auditPath,
    strategyName: flowMode,
    fsMode: flowMode,
    budgetSummary,
  };
}
