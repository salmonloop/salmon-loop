import { readFile } from '../../core/adapters/fs/node-fs.js';
import { recordAuditEvent } from '../../core/observability/audit-trail.js';
import { logger } from '../../core/observability/logger.js';
import type {
  RunOutcomeContext,
  RunOutcomeReport,
  RunOutcomeReporter,
} from '../../core/observability/run-outcome-reporter.js';
import { text } from '../../locales/index.js';

type LangfuseIngestionEvent =
  | {
      id: string;
      // Langfuse ingestion API uses upsert semantics on trace-create (no separate trace-update event).
      type: 'trace-create';
      timestamp: string;
      body: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'score-create';
      timestamp: string;
      body: Record<string, unknown>;
    };

type LangfuseIngestionResult = {
  successes: { id: string; status: number }[];
  errors: { id: string; status: number; message?: string; error?: string }[];
};

type LangfuseOutcomeFailureKind = 'timeout' | 'network' | 'unknown';

function nowIso(): string {
  return new Date().toISOString();
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePathPrefix(value: string | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return '/langfuse';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/, '');
  return trimmed || '/langfuse';
}

function buildBasicAuthHeader(username: string, password: string): string {
  // LiteLLM's built-in /langfuse proxy route expects Basic auth in the form "any:<key>".
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function buildStableId(parts: string[]): string {
  return parts
    .join(':')
    .replace(/[^a-zA-Z0-9:_-]/g, '_')
    .slice(0, 128);
}

function truncateForAudit(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]…`;
}

function truncateForLangfuse(value: string | undefined, max: number): string | undefined {
  const raw = (value || '').trim();
  if (!raw) return undefined;
  return raw.length <= max ? raw : `${raw.slice(0, max)}…[truncated]…`;
}

function buildPhaseDurations(traces: unknown): Record<string, number> | undefined {
  if (!Array.isArray(traces)) return undefined;
  const out: Record<string, number> = {};
  for (const t of traces) {
    if (!t || typeof t !== 'object') continue;
    const name = (t as any).name;
    const duration = (t as any).duration;
    if (typeof name === 'string' && typeof duration === 'number' && Number.isFinite(duration)) {
      out[name] = duration;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function tryReadAuditJson(
  auditPath: string | undefined,
): Promise<Record<string, any> | null> {
  if (!auditPath) return null;
  try {
    const raw = await readFile(auditPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data as Record<string, any>;
  } catch {
    return null;
  }
}

function extractNetworkErrorCode(error: unknown): string | undefined {
  const allow = (value: unknown) =>
    typeof value === 'string' && /^[A-Z0-9_]{2,32}$/.test(value) ? value : undefined;

  if (error && typeof error === 'object') {
    const e = error as any;
    return (
      allow(e.code) ||
      allow(e.cause?.code) ||
      allow(e.cause?.errno) ||
      allow(e.errno) ||
      allow(e.cause?.name)
    );
  }
  return undefined;
}

function classifyFailureKind(error: unknown, aborted: boolean): LangfuseOutcomeFailureKind {
  if (aborted) return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  if (extractNetworkErrorCode(error)) return 'network';
  if (error instanceof Error) return 'network';
  return 'unknown';
}

export interface LiteLlmLangfuseOutcomeReporterOptions {
  /**
   * Root URL of LiteLLM proxy (no trailing /v1).
   * Example: http://localhost:4000
   */
  proxyBaseUrl: string;
  /**
   * Path prefix of the Langfuse proxy route on the LiteLLM host.
   * Defaults to "/langfuse".
   */
  proxyPathPrefix?: string;
  /**
   * Optional LiteLLM Virtual Key used to authenticate calls to the proxy.
   *
   * NOTE: Some LiteLLM versions require Basic auth for /langfuse/* routes.
   * Passing this key lets the reporter work without any client-side Langfuse keys.
   */
  litellmApiKey?: string;
  timeoutMs?: number;
}

export class LiteLlmLangfuseOutcomeReporter implements RunOutcomeReporter {
  private readonly proxyBaseUrl: string;
  private readonly proxyPathPrefix: string;
  private readonly timeoutMs: number;
  private readonly litellmApiKey?: string;

  constructor(options: LiteLlmLangfuseOutcomeReporterOptions) {
    this.proxyBaseUrl = trimTrailingSlashes(options.proxyBaseUrl);
    this.proxyPathPrefix = normalizePathPrefix(options.proxyPathPrefix);
    this.litellmApiKey = options.litellmApiKey;
    this.timeoutMs = options.timeoutMs ?? 2500;
  }

  async report(report: RunOutcomeReport, ctx: RunOutcomeContext): Promise<void> {
    const traceId = ctx.runId;
    if (!traceId) return;

    const audit = await tryReadAuditJson(ctx.auditPath);
    const meta = audit?.meta && typeof audit.meta === 'object' ? audit.meta : undefined;
    const phaseDurations = buildPhaseDurations(audit?.traces);
    const durationMs =
      typeof meta?.duration === 'number' && Number.isFinite(meta.duration)
        ? meta.duration
        : undefined;
    const lastStep = typeof meta?.lastStep === 'string' ? meta.lastStep : undefined;

    const traceMetadata = {
      salmonloop: {
        runId: traceId,
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        success: report.success,
        reasonCode: report.reasonCode,
        attempts: report.attempts,
        failurePhase: report.failurePhase,
        errorCode: report.errorCode,
        lastStep,
        durationMs,
        phaseDurations,
      },
    };

    const scores = [
      { name: 'run_success', value: report.success ? 1 : 0 },
      { name: 'first_attempt_success', value: report.success && report.attempts === 1 ? 1 : 0 },
    ];

    const tags: string[] = [];
    tags.push('salmonloop');
    tags.push(report.success ? 'status:success' : 'status:failure');
    if (ctx.mode) tags.push(`mode:${ctx.mode}`);
    if (report.failurePhase) tags.push(`failurePhase:${report.failurePhase}`);
    if (report.errorCode) tags.push(`errorCode:${report.errorCode}`);

    const timestamp = nowIso();

    const traceUpsert: LangfuseIngestionEvent = {
      id: buildStableId([traceId, 'trace-create', timestamp]),
      type: 'trace-create',
      timestamp,
      body: {
        id: traceId,
        name: 'salmonloop.run',
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        input: {
          instruction: truncateForLangfuse(ctx.instruction, 2000),
          verify: truncateForLangfuse(ctx.verify, 500),
          mode: ctx.mode,
          repoPath: ctx.repoPath,
        },
        output: {
          success: report.success,
          reason: truncateForLangfuse(report.reason, 2000),
          reasonCode: report.reasonCode,
          attempts: report.attempts,
          failurePhase: report.failurePhase,
          errorCode: report.errorCode,
          changedFiles: report.changedFiles,
          lastStep,
          durationMs,
        },
        metadata: traceMetadata,
        tags,
      },
    };

    const scoreEvents: LangfuseIngestionEvent[] = scores.map((s) => ({
      id: buildStableId([traceId, 'score', s.name]),
      type: 'score-create',
      timestamp,
      body: {
        id: buildStableId([traceId, 'score', s.name]),
        traceId,
        name: s.name,
        value: s.value,
        dataType: 'NUMERIC',
      },
    }));

    const ok = await this.postIngestion([traceUpsert, ...scoreEvents], traceId);
    if (ok) {
      recordAuditEvent(
        'langfuse.outcome.reported',
        { traceId, ok: true, scores: scores.map((s) => s.name) },
        { source: 'observability', severity: 'low', scope: 'session' },
      );
      logger.debug(text.grizzco.langfuse.outcomeReported(traceId));
      return;
    }

    logger.warn(text.grizzco.langfuse.outcomeReportFailed(traceId));
  }

  private async postIngestion(events: LangfuseIngestionEvent[], traceId: string): Promise<boolean> {
    const url = `${this.proxyBaseUrl}${this.proxyPathPrefix}/api/public/ingestion`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.litellmApiKey) {
        headers.Authorization = buildBasicAuthHeader('any', this.litellmApiKey);
        // Also send the canonical LiteLLM auth header for deployments that rely on it.
        headers['x-litellm-api-key'] = this.litellmApiKey;
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ batch: events }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        // Capture a small response preview for debugging in audit logs (no secrets).
        let bodyPreview: string | undefined;
        try {
          bodyPreview = truncateForAudit(await resp.text(), 800);
        } catch {
          // ignore
        }
        recordAuditEvent(
          'langfuse.outcome.http_failed',
          {
            traceId,
            url,
            status: resp.status,
            statusText: resp.statusText,
            bodyPreview,
          },
          { source: 'observability', severity: 'low', scope: 'session' },
        );
        return false;
      }

      // Langfuse returns 207 with per-event errors; treat any event error as failure.
      try {
        const result = (await resp.json()) as LangfuseIngestionResult;
        if (Array.isArray(result?.errors) && result.errors.length > 0) {
          recordAuditEvent(
            'langfuse.outcome.ingestion_failed',
            {
              traceId,
              errors: result.errors.map((e) => ({
                id: e.id,
                status: e.status,
              })),
            },
            { source: 'observability', severity: 'low', scope: 'session' },
          );
          logger.debug(
            `[Langfuse] Ingestion returned errors for ids: ${result.errors
              .map((e) => e.id)
              .join(',')}`,
          );
          return false;
        }
      } catch {
        // If the proxy returns a non-JSON body, fall back to "ok".
      }

      return true;
    } catch (error) {
      const aborted = controller.signal.aborted;
      const kind = classifyFailureKind(error, aborted);
      const errorName = error instanceof Error ? error.name : undefined;
      const errorCode = extractNetworkErrorCode(error);
      recordAuditEvent(
        'langfuse.outcome.request_failed',
        {
          traceId,
          url,
          timeoutMs: this.timeoutMs,
          aborted,
          kind,
          errorName,
          errorCode,
        },
        { source: 'observability', severity: 'low', scope: 'session' },
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
