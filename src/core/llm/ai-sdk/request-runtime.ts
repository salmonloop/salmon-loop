import { recordAuditEvent, type AuditTrailMeta } from '../../observability/audit-trail.js';

import { classifyRetryableApiError } from './retry-classifier.js';

interface BaseAuditInput {
  requestId: string;
  modelId: string;
  attempt: number;
  startedAt: number;
  toolCount: number;
  streamed: boolean;
  auditCtx: AuditTrailMeta;
}

export function createAbortRuntime(params: { timeoutMs?: number; externalSignal?: AbortSignal }): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const abortController = new AbortController();
  const timeoutHandle =
    typeof params.timeoutMs === 'number' && params.timeoutMs > 0
      ? setTimeout(() => abortController.abort(), params.timeoutMs)
      : undefined;

  const onExternalAbort = () => abortController.abort();
  if (params.externalSignal) {
    if (params.externalSignal.aborted) {
      abortController.abort();
    } else {
      params.externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (params.externalSignal) {
      params.externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  return { signal: abortController.signal, cleanup };
}

export function recordAiSdkRequestSuccess(input: BaseAuditInput): void {
  recordAuditEvent(
    'llm.request',
    {
      requestId: input.requestId,
      runId: input.auditCtx.correlationId,
      phase: input.auditCtx.phase,
      provider: 'ai-sdk',
      streamed: input.streamed,
      modelId: input.modelId,
      attempt: input.attempt,
      durationMs: Date.now() - input.startedAt,
      toolCount: input.toolCount,
      status: 'ok',
    },
    { source: 'llm', severity: 'low', scope: 'session' },
  );
}

export function recordAiSdkRequestError(input: BaseAuditInput & { error: unknown }): void {
  const cls = classifyRetryableApiError(input.error);
  recordAuditEvent(
    'llm.request',
    {
      requestId: input.requestId,
      runId: input.auditCtx.correlationId,
      phase: input.auditCtx.phase,
      provider: 'ai-sdk',
      streamed: input.streamed,
      modelId: input.modelId,
      attempt: input.attempt,
      durationMs: Date.now() - input.startedAt,
      toolCount: input.toolCount,
      status: 'error',
      statusCode: cls.statusCode,
      networkCode: cls.networkCode,
      retryable: cls.retryable,
      retryReason: cls.reason,
    },
    { source: 'llm', severity: 'low', scope: 'session' },
  );
}

export function createAiSdkRetryLogger(params: { modelId: string; streamed: boolean }) {
  return ({ attempt, delayMs, error }: { attempt: number; delayMs: number; error: unknown }) => {
    const cls = classifyRetryableApiError(error);
    recordAuditEvent(
      'llm.retry',
      {
        provider: 'ai-sdk',
        modelId: params.modelId,
        streamed: params.streamed,
        attempt,
        delayMs,
        reason: cls.reason,
        statusCode: cls.statusCode,
        networkCode: cls.networkCode,
      },
      { source: 'llm', severity: 'low', scope: 'session' },
    );
  };
}

export function isRetryableAiSdkError(error: unknown): boolean {
  return classifyRetryableApiError(error).retryable;
}
