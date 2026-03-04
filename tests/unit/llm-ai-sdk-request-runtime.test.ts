import { describe, expect, it } from 'bun:test';

import { prepareAiSdkAttempt } from '../../src/core/llm/ai-sdk/request-runtime.js';
import { clearAuditContext, setAuditContext } from '../../src/core/observability/audit-trail.js';

describe('prepareAiSdkAttempt', () => {
  it('builds attempt context with toolCount and langfuse headers when enabled', () => {
    clearAuditContext();
    setAuditContext({
      correlationId: 'run-1',
      phase: 'PATCH',
      sessionId: 'sess-1',
      userId: 'user-1',
      observationName: 'PATCH:unified-diff',
    });

    const attempt = prepareAiSdkAttempt({
      timeoutMs: 1000,
      externalSignal: undefined,
      langfuseEnabled: true,
      requestId: 'req-1',
      attempt: 2,
      tools: { read: {}, write: {} },
    });

    expect(attempt.startedAt).toBeTypeOf('number');
    expect(attempt.toolCount).toBe(2);
    expect(attempt.auditCtx.phase).toBe('PATCH');
    expect(attempt.langfuseHeaders).toMatchObject({
      langfuse_trace_id: 'run-1',
      langfuse_observation_name: 'PATCH:unified-diff',
      langfuse_observation_id: 'req-1-a2',
      langfuse_session_id: 'sess-1',
      langfuse_trace_user_id: 'user-1',
    });

    attempt.cleanup();
  });

  it('returns empty headers when langfuse is disabled', () => {
    clearAuditContext();
    setAuditContext({
      correlationId: 'run-2',
      phase: 'PLAN',
    });

    const attempt = prepareAiSdkAttempt({
      timeoutMs: undefined,
      externalSignal: undefined,
      langfuseEnabled: false,
      requestId: 'req-2',
      attempt: 1,
      tools: undefined,
    });

    expect(attempt.toolCount).toBe(0);
    expect(attempt.langfuseHeaders).toEqual({});
    attempt.cleanup();
  });

  it('propagates already-aborted external signal', () => {
    const controller = new AbortController();
    controller.abort();

    const attempt = prepareAiSdkAttempt({
      timeoutMs: undefined,
      externalSignal: controller.signal,
      langfuseEnabled: false,
      requestId: 'req-3',
      attempt: 1,
      tools: undefined,
    });

    expect(attempt.abortSignal.aborted).toBe(true);
    attempt.cleanup();
  });
});
