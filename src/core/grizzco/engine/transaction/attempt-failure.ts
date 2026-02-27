import { text } from '../../../../locales/index.js';
import { sanitizeError } from '../../../llm/errors.js';
import { REDACTED_ERROR_TOKEN } from '../../../observability/error-envelope.js';
import { EXECUTION_PHASES } from '../../../types/index.js';
import type { ExecutionPhase, FlowMode, LoopReasonCode } from '../../../types/index.js';
import { classifyError, isRetryable } from '../../../verification/runner.js';
import type { FlowReport } from '../pipeline/pipeline.js';
import type { ShrinkCtx } from '../pipeline/types.js';

export interface AttemptFailureDetails {
  reason: string;
  reasonCode: LoopReasonCode;
  failurePhase: ExecutionPhase;
  retryable: boolean;
  errorCode?: string;
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

function inferFailurePhase(flowReport: FlowReport): ExecutionPhase {
  const failedTrace = [...flowReport.traces].reverse().find((trace) => Boolean(trace.error));
  if (failedTrace && (EXECUTION_PHASES as readonly string[]).includes(failedTrace.name)) {
    return failedTrace.name as ExecutionPhase;
  }
  return 'VERIFY';
}

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    return (
      (error as { llmCode?: string; code?: string; name?: string }).llmCode ??
      (error as { llmCode?: string; code?: string; name?: string }).code ??
      (error as { llmCode?: string; code?: string; name?: string }).name
    );
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
  if (sanitized === REDACTED_ERROR_TOKEN) {
    return text.errors.technicalDetailsHidden;
  }
  return sanitized;
}

export function resolveAttemptFailure(params: {
  flowReport: FlowReport;
  context?: ShrinkCtx;
  flowMode: FlowMode;
}): AttemptFailureDetails | undefined {
  const { flowReport, context, flowMode } = params;
  const verifyOk = flowMode === 'review' ? true : context?.verifyResult?.ok !== false;
  const applyBackFailed =
    flowMode !== 'review' &&
    context?.applyBackResult?.success === false &&
    !context.applyBackResult.skipped;

  if (applyBackFailed) {
    return {
      reason:
        context.applyBackResult?.safeMessage ||
        context.applyBackResult?.error ||
        text.loop.applyBackFailed,
      reasonCode: 'APPLY_BACK_FAILED',
      failurePhase: 'APPLY_BACK',
      retryable: false,
      errorCode: context.applyBackResult?.errorCode || 'APPLY_BACK_FAILED',
    };
  }

  if (flowReport.success && verifyOk) {
    return undefined;
  }

  const errorCode = extractErrorCode(flowReport.error) ?? extractErrorCodeFromTraces(flowReport);

  if (errorCode === 'PREFLIGHT_NOT_GIT') {
    return {
      reason: sanitizeReason(flowReport.error),
      reasonCode: 'PREFLIGHT_NOT_GIT',
      failurePhase: 'PREFLIGHT',
      retryable: false,
      errorCode,
    };
  }
  if (errorCode === 'PREFLIGHT_DIRTY') {
    return {
      reason: sanitizeReason(flowReport.error),
      reasonCode: 'PREFLIGHT_DIRTY',
      failurePhase: 'PREFLIGHT',
      retryable: false,
      errorCode,
    };
  }
  if (errorCode && NON_RETRYABLE_PERMISSION_CODES.has(errorCode)) {
    return {
      reason: sanitizeReason(flowReport.error),
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'CONTEXT',
      retryable: false,
      errorCode,
    };
  }

  if (flowMode !== 'review' && context?.verifyResult?.ok === false) {
    const verifyOutput = context.verifyResult.output || text.loop.loopExecutionFailed;
    const errorType = classifyError(verifyOutput);
    return {
      reason: sanitizeReason(context.lastError || verifyOutput),
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      retryable: isRetryable(errorType),
      errorCode: String(errorType),
    };
  }

  const failurePhase = inferFailurePhase(flowReport);
  const reason = sanitizeReason(context?.lastError || flowReport.error);
  const hasStructuredFailureTrace = flowReport.traces.some((trace) => Boolean(trace.error));
  const retryableByPhase = hasStructuredFailureTrace && RETRYABLE_PHASES.has(failurePhase);

  if (failurePhase === 'ROLLBACK') {
    return {
      reason,
      reasonCode: 'ROLLBACK_FAILED',
      failurePhase,
      retryable: false,
      errorCode,
    };
  }

  return {
    reason,
    reasonCode: 'LOOP_FAILED',
    failurePhase,
    retryable: retryableByPhase,
    errorCode,
  };
}
