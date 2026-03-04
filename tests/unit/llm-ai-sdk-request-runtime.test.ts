import { describe, expect, it } from 'bun:test';

import {
  executeAiSdkAttempt,
  executeAiSdkStreamAttempt,
  prepareAiSdkAttempt,
} from '../../src/core/llm/ai-sdk/request-runtime.js';
import {
  clearAuditContext,
  clearAuditTrail,
  getAuditTrail,
  setAuditContext,
} from '../../src/core/observability/audit-trail.js';

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
      tools: { read: {}, write: {} } as any,
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

describe('executeAiSdkAttempt', () => {
  it('records success and always cleans up', async () => {
    clearAuditTrail();
    let cleaned = false;

    const result = await executeAiSdkAttempt({
      requestId: 'req-success',
      modelId: 'gpt-test',
      attempt: 1,
      streamed: false,
      prepare: () => ({
        startedAt: Date.now() - 5,
        auditCtx: { correlationId: 'run-1', phase: 'PLAN' },
        abortSignal: new AbortController().signal,
        cleanup: () => {
          cleaned = true;
        },
        langfuseHeaders: {},
        toolCount: 2,
      }),
      run: async () => 'ok',
    });

    expect(result).toBe('ok');
    expect(cleaned).toBe(true);
    const trail = getAuditTrail();
    const requestEvents = trail.filter((event) => event.action === 'llm.request');
    expect(requestEvents.length).toBe(1);
    expect((requestEvents[0]?.details as any).status).toBe('ok');
  });

  it('records error and always cleans up', async () => {
    clearAuditTrail();
    let cleaned = false;

    await expect(
      executeAiSdkAttempt({
        requestId: 'req-error',
        modelId: 'gpt-test',
        attempt: 1,
        streamed: false,
        prepare: () => ({
          startedAt: Date.now() - 5,
          auditCtx: { correlationId: 'run-1', phase: 'PATCH' },
          abortSignal: new AbortController().signal,
          cleanup: () => {
            cleaned = true;
          },
          langfuseHeaders: {},
          toolCount: 1,
        }),
        run: async () => {
          throw new Error('fail');
        },
      }),
    ).rejects.toThrow('fail');

    expect(cleaned).toBe(true);
    const trail = getAuditTrail();
    const requestEvents = trail.filter((event) => event.action === 'llm.request');
    expect(requestEvents.length).toBe(1);
    expect((requestEvents[0]?.details as any).status).toBe('error');
  });
});

describe('executeAiSdkStreamAttempt', () => {
  it('records success and yields stream items', async () => {
    clearAuditTrail();
    let cleaned = false;

    const items: string[] = [];
    for await (const item of executeAiSdkStreamAttempt({
      requestId: 'stream-success',
      modelId: 'gpt-test',
      attempt: 1,
      streamed: true,
      prepare: () => ({
        startedAt: Date.now() - 5,
        auditCtx: { correlationId: 'run-1', phase: 'REPORT' },
        abortSignal: new AbortController().signal,
        cleanup: () => {
          cleaned = true;
        },
        langfuseHeaders: {},
        toolCount: 0,
      }),
      run: async function* () {
        yield 'a';
        yield 'b';
      },
    })) {
      items.push(item);
    }

    expect(items).toEqual(['a', 'b']);
    expect(cleaned).toBe(true);
    const trail = getAuditTrail();
    const requestEvents = trail.filter((event) => event.action === 'llm.request');
    expect(requestEvents.length).toBe(1);
    expect((requestEvents[0]?.details as any).status).toBe('ok');
  });

  it('records error and cleans up when stream fails', async () => {
    clearAuditTrail();
    let cleaned = false;

    await expect(
      (async () => {
        for await (const _item of executeAiSdkStreamAttempt({
          requestId: 'stream-error',
          modelId: 'gpt-test',
          attempt: 1,
          streamed: true,
          prepare: () => ({
            startedAt: Date.now() - 5,
            auditCtx: { correlationId: 'run-1', phase: 'REPORT' },
            abortSignal: new AbortController().signal,
            cleanup: () => {
              cleaned = true;
            },
            langfuseHeaders: {},
            toolCount: 0,
          }),
          run: async function* () {
            yield* [];
            throw new Error('stream-fail');
          },
        })) {
          // no-op
        }
      })(),
    ).rejects.toThrow('stream-fail');

    expect(cleaned).toBe(true);
    const trail = getAuditTrail();
    const requestEvents = trail.filter((event) => event.action === 'llm.request');
    expect(requestEvents.length).toBe(1);
    expect((requestEvents[0]?.details as any).status).toBe('error');
  });
});
