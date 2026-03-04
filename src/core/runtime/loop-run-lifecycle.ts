import { randomBytes } from 'crypto';

import { createFlowEventAdapter, LoopTelemetry } from '../grizzco/engine/observability/index.js';
import { buildLoopFailureResult } from '../grizzco/engine/outcome/index.js';
import { HostRunner } from '../grizzco/runtime/host/index.js';
import { sanitizeError } from '../llm/errors.js';
import {
  clearAuditTrail,
  recordAuditEvent,
  setAuditContext,
} from '../observability/audit-trail.js';
import { extractErrorCode, REDACTED_ERROR_TOKEN } from '../observability/error-envelope.js';
import {
  Phase,
  type FlowMode,
  type LoopEvent,
  type LoopOptions,
  type LoopResult,
} from '../types/runtime.js';

export type LoopRunMode = 'run';

export interface LoopLifecycleContext {
  correlationId: string;
  now: () => Date;
  telemetry: LoopTelemetry;
  emitSanitized: (event: LoopEvent) => void;
  emitFlow: (event: LoopEvent) => void;
  hostRunner: HostRunner;
  shadowTaskId: string;
  runMode: LoopRunMode;
}

function buildSafeMeta(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (!('safeMeta' in error)) return undefined;
  const safeMeta = (error as { safeMeta?: unknown }).safeMeta;
  if (!safeMeta || typeof safeMeta !== 'object') return undefined;
  return safeMeta as Record<string, unknown>;
}

export function initializeLoopLifecycle(options: LoopOptions): LoopLifecycleContext {
  clearAuditTrail();
  const correlationId = `run-${randomBytes(4).toString('hex')}`;
  setAuditContext({
    correlationId,
    scope: 'session',
    sessionId: options.langfuseSessionId,
    userId: options.langfuseUserId,
  });

  const now = () => new Date();
  const telemetry = new LoopTelemetry(now);
  const { emitSanitized, emitFlow } = createFlowEventAdapter({
    onEvent: options.onEvent,
    telemetry,
  });

  const hostRunner = new HostRunner(options, emitSanitized, now);
  const shadowTaskId = randomBytes(4).toString('hex');
  const runMode: LoopRunMode = 'run';

  return {
    correlationId,
    now,
    telemetry,
    emitSanitized,
    emitFlow,
    hostRunner,
    shadowTaskId,
    runMode,
  };
}

export function buildLoopFailureFromError(params: {
  error: unknown;
  options: LoopOptions;
  telemetry: LoopTelemetry;
  emitSanitized: (event: LoopEvent) => void;
  now: () => Date;
  latestAuditPath?: string;
}): LoopResult {
  const extractedCode = extractErrorCode(params.error);
  const errorCode = extractedCode && extractedCode !== 'Error' ? extractedCode : undefined;
  const message = sanitizeError(params.error);
  recordAuditEvent(
    'run.failed.diagnostic',
    {
      errorName: params.error instanceof Error ? params.error.name : typeof params.error,
      errorCode,
      phase: Phase.PREFLIGHT,
      source: 'runtime.loop.catch',
      redacted: message === REDACTED_ERROR_TOKEN,
      safeMeta: buildSafeMeta(params.error),
    },
    { source: 'runtime', severity: 'high', scope: 'session', phase: Phase.PREFLIGHT },
  );
  params.telemetry.recordLog(Phase.PREFLIGHT, message, false);
  params.emitSanitized({ type: 'log', level: 'error', message, timestamp: params.now() });
  const fallbackFlowMode: FlowMode = params.options.mode ?? 'patch';
  return buildLoopFailureResult({
    message,
    flowMode: fallbackFlowMode,
    telemetry: params.telemetry,
    auditPath: params.latestAuditPath,
    reasonCode: 'LOOP_FAILED',
    failurePhase: Phase.PREFLIGHT,
    errorCode,
  });
}
