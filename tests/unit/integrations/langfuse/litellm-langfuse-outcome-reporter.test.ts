import {
  clearAuditContext,
  clearAuditTrail,
  getAuditTrail,
  setAuditContext,
} from '../../../../src/core/observability/audit-trail.js';
import { LiteLlmLangfuseOutcomeReporter } from '../../../../src/integrations/langfuse/litellm-langfuse-outcome-reporter.js';

function lastAuditAction(prefix: string): string | undefined {
  const events = getAuditTrail().filter((e) => String(e.action || '').startsWith(prefix));
  return events.length > 0 ? events[events.length - 1]!.action : undefined;
}

describe('LiteLlmLangfuseOutcomeReporter', () => {
  beforeEach(() => {
    clearAuditTrail();
    clearAuditContext();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAuditTrail();
    clearAuditContext();
  });

  it('records http_failed when ingestion responds non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: async () => 'nope',
        } as any;
      }),
    );

    const reporter = new LiteLlmLangfuseOutcomeReporter({
      proxyBaseUrl: 'https://litellm.example',
      proxyPathPrefix: '/langfuse',
      litellmApiKey: 'vk-test',
      timeoutMs: 250,
    });

    setAuditContext({ correlationId: 'run-test', scope: 'session' });

    await reporter.report(
      { success: true, reason: 'ok', reasonCode: 'SUCCESS', attempts: 1 },
      { runId: 'run-test' },
    );

    expect(lastAuditAction('langfuse.outcome.')).toBe('langfuse.outcome.http_failed');
  });

  it('records request_failed when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );

    const reporter = new LiteLlmLangfuseOutcomeReporter({
      proxyBaseUrl: 'https://litellm.example',
      proxyPathPrefix: '/langfuse',
      litellmApiKey: 'vk-test',
      timeoutMs: 250,
    });

    await reporter.report(
      { success: false, reason: 'fail', reasonCode: 'LOOP_FAILED', attempts: 2 },
      { runId: 'run-test' },
    );

    expect(lastAuditAction('langfuse.outcome.')).toBe('langfuse.outcome.request_failed');
  });

  it('records ingestion_failed when response includes per-event errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: true,
          json: async () => ({
            successes: [{ id: 'x', status: 200 }],
            errors: [{ id: 'y', status: 400, message: 'bad' }],
          }),
        } as any;
      }),
    );

    const reporter = new LiteLlmLangfuseOutcomeReporter({
      proxyBaseUrl: 'https://litellm.example',
      proxyPathPrefix: '/langfuse',
      litellmApiKey: 'vk-test',
      timeoutMs: 250,
    });

    await reporter.report(
      { success: true, reason: 'ok', reasonCode: 'SUCCESS', attempts: 1 },
      { runId: 'run-test' },
    );

    expect(lastAuditAction('langfuse.outcome.')).toBe('langfuse.outcome.ingestion_failed');
  });

  it('sends Basic auth + x-litellm-api-key when litellmApiKey is provided', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => {
      return { ok: true, json: async () => ({ successes: [], errors: [] }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);

    const reporter = new LiteLlmLangfuseOutcomeReporter({
      proxyBaseUrl: 'https://litellm.example',
      proxyPathPrefix: '/langfuse',
      litellmApiKey: 'vk-test',
      timeoutMs: 250,
    });

    await reporter.report(
      { success: true, reason: 'ok', reasonCode: 'SUCCESS', attempts: 1 },
      { runId: 'run-test' },
    );

    const firstCall = fetchMock.mock.calls[0];
    expect(Array.isArray(firstCall)).toBe(true);
    const init = (firstCall?.[1] ?? undefined) as any;
    expect(init?.headers?.Authorization).toMatch(/^Basic\s+/);
    expect(init?.headers?.['x-litellm-api-key']).toBe('vk-test');
  });
});
