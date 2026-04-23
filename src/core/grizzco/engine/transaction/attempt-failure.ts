import { text } from '../../../../locales/index.js';
import { buildFailureGuidance } from '../../../failure/diagnostics.js';
import { sanitizeError } from '../../../llm/errors.js';
import { mapErrorForDisplay } from '../../../observability/error-mapping.js';
import { resolveExecutionProfile } from '../../../runtime/execution-profile.js';
import { isRecoverableToolInputErrorCode } from '../../../tools/recoverable-tool-errors.js';
import { EXECUTION_PHASES } from '../../../types/runtime.js';
import type {
  ExecutionPhase,
  FlowMode,
  LoopInputRequired,
  LoopReasonCode,
} from '../../../types/runtime.js';
import { classifyError, isRetryable } from '../../../verification/runner.js';
import type { FlowReport } from '../pipeline/pipeline.js';
import type { ShrinkCtx } from '../pipeline/types.js';

export interface AttemptFailureDetails {
  reason: string;
  reasonCode: LoopReasonCode;
  failurePhase: ExecutionPhase;
  retryable: boolean;
  errorCode?: string;
  diagnosticCode: string;
  safeHint: string;
  remediationSteps: string[];
  inputRequired?: LoopInputRequired;
}

const RETRYABLE_PHASES = new Set<ExecutionPhase>([
  'CONTEXT',
  'EXPLORE',
  'PLAN',
  'PATCH',
  'VALIDATE',
  'AST_VALIDATE',
  'APPLY',
  'VERIFY',
  'SHRINK',
]);

const NON_RETRYABLE_PERMISSION_CODES = new Set([
  'PERMISSION_REQUIRED_CONTEXT_CACHE_OUTSIDE_ROOT',
  'PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT',
]);

const NON_RETRYABLE_LLM_CODES = new Set(['LLM_AUTHENTICATION_FAILED']);

function inferFailurePhase(flowReport: FlowReport): ExecutionPhase {
  const failedTrace = [...flowReport.traces].reverse().find((trace) => Boolean(trace.error));
  if (failedTrace && (EXECUTION_PHASES as readonly string[]).includes(failedTrace.name)) {
    return failedTrace.name as ExecutionPhase;
  }
  return 'VERIFY';
}

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const err = error as { llmCode?: string; code?: string; name?: string; errorCode?: string };
    // Prioritize code (from SalmonError) for better specificity
    // SalmonError stores the error code in the 'code' property
    return err.llmCode ?? err.code ?? err.errorCode ?? err.name;
  }
  return undefined;
}

function extractErrorCodeFromTraces(flowReport: FlowReport): string | undefined {
  const traceWithError = [...flowReport.traces].reverse().find((trace) => Boolean(trace.error));
  if (!traceWithError) return undefined;
  return extractErrorCode(traceWithError.error);
}

function sanitizeReason(value: unknown): string {
  const sanitized = sanitizeError(value) || text.loop.loopExecutionFailed;
  return mapErrorForDisplay({ message: sanitized }).message;
}

function extractInputRequired(error: unknown): LoopInputRequired | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = 'inputRequired' in (error as any) ? (error as any).inputRequired : (error as any);
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.prompt !== 'string' || typeof value.type !== 'string') return undefined;
  return value as LoopInputRequired;
}

function extractInterrupt(error: unknown):
  | {
      type: string;
      reason?: string;
      prompt?: string;
      data?: Record<string, unknown>;
    }
  | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as any).interrupt;
  if (!value || typeof value !== 'object') return undefined;
  if (typeof (value as any).type !== 'string') return undefined;
  return value as {
    type: string;
    reason?: string;
    prompt?: string;
    data?: Record<string, unknown>;
  };
}

export function resolveAttemptFailure(params: {
  flowReport: FlowReport;
  context?: ShrinkCtx;
  flowMode: FlowMode;
}): AttemptFailureDetails | undefined {
  const { flowReport, context, flowMode } = params;
  const profile = resolveExecutionProfile(flowMode);
  const interrupt = extractInterrupt(flowReport.error);
  const interruptCode = extractErrorCode(flowReport.error);
  if (interruptCode === 'INTERRUPT_REQUIRED' && interrupt?.type === 'awaiting_input') {
    const inputRequired = extractInputRequired(interrupt.data?.inputRequired);
    if (!inputRequired) return undefined;
    const failurePhase = inferFailurePhase(flowReport);
    const reason = interrupt.prompt || inputRequired.prompt || text.tools.askUserPromptDefault;
    return {
      reason,
      reasonCode: 'AWAITING_INPUT',
      failurePhase,
      retryable: false,
      errorCode: 'INTERRUPT_REQUIRED',
      diagnosticCode: 'INTERRUPT_REQUIRED',
      safeHint: reason,
      remediationSteps: [],
      inputRequired,
    };
  }
  const verifyOk =
    profile.verifyPolicy === 'never' ? true : context?.verifyResult?.ok !== false;
  const applyBackFailed =
    profile.failurePolicy === 'rollback' &&
    context?.applyBackResult?.success === false &&
    !context.applyBackResult.skipped;
  const environmentMode = context?.options?.environmentMode;

  if (applyBackFailed) {
    const fallbackReason =
      context.applyBackResult?.safeMessage ||
      context.applyBackResult?.error ||
      text.loop.applyBackFailed;
    const guidance = buildFailureGuidance({
      reasonCode: 'APPLY_BACK_FAILED',
      failurePhase: 'APPLY_BACK',
      errorCode: context.applyBackResult?.errorCode || 'APPLY_BACK_FAILED',
      environmentMode,
      fallbackReason,
    });
    return {
      reason: guidance.safeHint,
      reasonCode: 'APPLY_BACK_FAILED',
      failurePhase: 'APPLY_BACK',
      retryable: false,
      errorCode: context.applyBackResult?.errorCode || 'APPLY_BACK_FAILED',
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }

  if (flowReport.success && verifyOk) {
    return undefined;
  }

  const errorCode = extractErrorCode(flowReport.error) ?? extractErrorCodeFromTraces(flowReport);

  if (errorCode === 'PREFLIGHT_NOT_GIT') {
    const fallbackReason = sanitizeReason(flowReport.error);
    const guidance = buildFailureGuidance({
      reasonCode: 'PREFLIGHT_NOT_GIT',
      failurePhase: 'PREFLIGHT',
      errorCode,
      environmentMode,
      fallbackReason,
    });
    return {
      reason: guidance.safeHint,
      reasonCode: 'PREFLIGHT_NOT_GIT',
      failurePhase: 'PREFLIGHT',
      retryable: false,
      errorCode,
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }
  if (errorCode === 'PREFLIGHT_DIRTY') {
    const fallbackReason = sanitizeReason(flowReport.error);
    const guidance = buildFailureGuidance({
      reasonCode: 'PREFLIGHT_DIRTY',
      failurePhase: 'PREFLIGHT',
      errorCode,
      environmentMode,
      fallbackReason,
    });
    return {
      reason: guidance.safeHint,
      reasonCode: 'PREFLIGHT_DIRTY',
      failurePhase: 'PREFLIGHT',
      retryable: false,
      errorCode,
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }
  if (errorCode && NON_RETRYABLE_PERMISSION_CODES.has(errorCode)) {
    const fallbackReason = sanitizeReason(flowReport.error);
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'CONTEXT',
      errorCode,
      environmentMode,
      fallbackReason,
    });
    return {
      reason: guidance.safeHint,
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'CONTEXT',
      retryable: false,
      errorCode,
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }
  if (errorCode && NON_RETRYABLE_LLM_CODES.has(errorCode)) {
    const failurePhase = inferFailurePhase(flowReport);
    const fallbackReason = sanitizeReason(flowReport.error);
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase,
      errorCode,
      environmentMode,
      fallbackReason,
    });
    return {
      reason: guidance.safeHint,
      reasonCode: 'LOOP_FAILED',
      failurePhase,
      retryable: false,
      errorCode,
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }

  if (profile.verifyPolicy !== 'never' && context?.verifyResult?.ok === false) {
    const verifyOutput = context.verifyResult.output || text.loop.loopExecutionFailed;
    const errorType = classifyError(verifyOutput);
    const fallbackReason = sanitizeReason(context.lastError || verifyOutput);
    const guidance = buildFailureGuidance({
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      errorCode: String(errorType),
      verifyOutput,
      environmentMode,
      fallbackReason,
    });
    return {
      reason: guidance.safeHint,
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      retryable: isRetryable(errorType),
      errorCode: String(errorType),
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }

  const failurePhase = inferFailurePhase(flowReport);
  const fallbackReason = sanitizeReason(context?.lastError || flowReport.error);
  if (isRecoverableToolInputErrorCode(errorCode)) {
    const guidance = buildFailureGuidance({
      reasonCode: 'TOOL_CORRECTION_REQUIRED',
      failurePhase,
      errorCode,
      environmentMode,
      fallbackReason,
    });
    return {
      reason: guidance.safeHint,
      reasonCode: 'TOOL_CORRECTION_REQUIRED',
      failurePhase,
      retryable: RETRYABLE_PHASES.has(failurePhase),
      errorCode,
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }

  const guidance = buildFailureGuidance({
    reasonCode: failurePhase === 'ROLLBACK' ? 'ROLLBACK_FAILED' : 'LOOP_FAILED',
    failurePhase,
    errorCode,
    environmentMode,
    fallbackReason,
  });
  const hasStructuredFailureTrace = flowReport.traces.some((trace) => Boolean(trace.error));
  const retryableByPhase = hasStructuredFailureTrace && RETRYABLE_PHASES.has(failurePhase);

  if (failurePhase === 'ROLLBACK') {
    return {
      reason: guidance.safeHint,
      reasonCode: 'ROLLBACK_FAILED',
      failurePhase,
      retryable: false,
      errorCode,
      diagnosticCode: guidance.diagnosticCode,
      safeHint: guidance.safeHint,
      remediationSteps: guidance.remediationSteps,
    };
  }

  return {
    reason: guidance.safeHint,
    reasonCode: 'LOOP_FAILED',
    failurePhase,
    retryable: retryableByPhase,
    errorCode,
    diagnosticCode: guidance.diagnosticCode,
    safeHint: guidance.safeHint,
    remediationSteps: guidance.remediationSteps,
  };
}
