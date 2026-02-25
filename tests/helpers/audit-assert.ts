import type { AuditTrailEvent } from '../../src/core/observability/audit-trail.js';

import { withAuditCapture } from './bun-test-harness.ts';

type AuditCaptureResult<T> = { result: T; events: AuditTrailEvent[] };

export async function captureAuditEvents<T>(
  callback: () => T | Promise<T>,
): Promise<AuditCaptureResult<Awaited<T>>> {
  return await withAuditCapture(callback);
}

export async function expectAuditAction<T>(
  action: string,
  callback: () => T | Promise<T>,
): Promise<AuditCaptureResult<Awaited<T>>> {
  const captured = await captureAuditEvents(callback);
  const hasAction = captured.events.some((event) => event.action === action);
  if (!hasAction) {
    throw new Error(
      `Expected audit action "${action}". Observed actions: ${captured.events
        .map((event) => event.action)
        .join(', ')}`,
    );
  }
  return captured;
}
