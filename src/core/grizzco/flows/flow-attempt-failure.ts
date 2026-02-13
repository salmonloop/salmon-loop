import { text } from '../../../locales/index.js';
import { sanitizeError } from '../../llm/errors.js';
import { EXECUTION_PHASES } from '../../types.js';
import type { ExecutionPhase, FlowMode, LoopReasonCode } from '../../types.js';
import { classifyError, isRetryable } from '../../verify.js';
import type { FlowReport } from '../pipeline.js';
import type { ShrinkCtx } from '../types.js';

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

function sanitizeReason(value: unknown): string {
  return sanitizeError(value) || text.loop.loopExecutionFailed;
}

export function resolveAttemptFailure(params: {
  flowReport: FlowReport;
  context?: ShrinkCtx;
  flowMode: FlowMode;
}): AttemptFailureDetails {
  const { flowReport, context, flowMode } = params;
  const errorCode = extractErrorCode(flowReport.error);

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
