import {
  getAuditContext,
  recordAuditEvent,
  type AuditTrailMeta,
} from '../../observability/audit-trail.js';

import { buildLangfuseHeaders } from './langfuse-headers.js';
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

export interface PreparedAiSdkAttempt {
  startedAt: number;
  auditCtx: AuditTrailMeta;
  abortSignal: AbortSignal;
  cleanup: () => void;
  langfuseHeaders: Record<string, string>;
  toolCount: number;
}

interface AttemptExecutionInput {
  requestId: string;
  modelId: string;
  attempt: number;
  streamed: boolean;
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

export function prepareAiSdkAttempt(params: {
  timeoutMs?: number;
  externalSignal?: AbortSignal;
  langfuseEnabled: boolean;
  requestId: string;
  attempt: number;
  tools?: Record<string, unknown>;
}): PreparedAiSdkAttempt {
  const startedAt = Date.now();
  const auditCtx = getAuditContext();
  const { signal: abortSignal, cleanup } = createAbortRuntime({
    timeoutMs: params.timeoutMs,
    externalSignal: params.externalSignal,
  });
  const langfuseHeaders = buildLangfuseHeaders(params.langfuseEnabled, {
    runId: auditCtx.correlationId,
    phase: auditCtx.phase,
    observationName: auditCtx.observationName,
    observationId: `${params.requestId}-a${params.attempt}`,
    sessionId: auditCtx.sessionId,
    userId: auditCtx.userId,
  });
  const toolCount = params.tools ? Object.keys(params.tools).length : 0;

  return {
    startedAt,
    auditCtx,
    abortSignal,
    cleanup,
    langfuseHeaders,
    toolCount,
  };
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

export async function executeAiSdkAttempt<T>(
  input: AttemptExecutionInput & {
    prepare: () => PreparedAiSdkAttempt;
    run: (attemptCtx: PreparedAiSdkAttempt) => Promise<T>;
  },
): Promise<T> {
  const attemptCtx = input.prepare();
  try {
    const result = await input.run(attemptCtx);
    recordAiSdkRequestSuccess({
      requestId: input.requestId,
      modelId: input.modelId,
      attempt: input.attempt,
      startedAt: attemptCtx.startedAt,
      toolCount: attemptCtx.toolCount,
      streamed: input.streamed,
      auditCtx: attemptCtx.auditCtx,
    });
    return result;
  } catch (error) {
    recordAiSdkRequestError({
      requestId: input.requestId,
      modelId: input.modelId,
      attempt: input.attempt,
      startedAt: attemptCtx.startedAt,
      toolCount: attemptCtx.toolCount,
      streamed: input.streamed,
      auditCtx: attemptCtx.auditCtx,
      error,
    });
    throw error;
  } finally {
    attemptCtx.cleanup();
  }
}

export async function* executeAiSdkStreamAttempt<T>(
  input: AttemptExecutionInput & {
    prepare: () => PreparedAiSdkAttempt;
    run: (attemptCtx: PreparedAiSdkAttempt) => AsyncIterable<T>;
  },
): AsyncIterable<T> {
  const attemptCtx = input.prepare();
  try {
    for await (const item of input.run(attemptCtx)) {
      yield item;
    }
    recordAiSdkRequestSuccess({
      requestId: input.requestId,
      modelId: input.modelId,
      attempt: input.attempt,
      startedAt: attemptCtx.startedAt,
      toolCount: attemptCtx.toolCount,
      streamed: input.streamed,
      auditCtx: attemptCtx.auditCtx,
    });
  } catch (error) {
    recordAiSdkRequestError({
      requestId: input.requestId,
      modelId: input.modelId,
      attempt: input.attempt,
      startedAt: attemptCtx.startedAt,
      toolCount: attemptCtx.toolCount,
      streamed: input.streamed,
      auditCtx: attemptCtx.auditCtx,
      error,
    });
    throw error;
  } finally {
    attemptCtx.cleanup();
  }
}
