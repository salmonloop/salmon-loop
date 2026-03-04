import { recordAuditEvent, type AuditTrailMeta } from '../observability/audit-trail.js';
import type { LoopEvent } from '../types/runtime.js';

import type { LoopRunMode } from './loop-run-lifecycle.js';

export function recordLoopRunStart(params: {
  emitSanitized: (event: LoopEvent) => void;
  runMode: LoopRunMode;
  now: () => Date;
}): void {
  params.emitSanitized({ type: 'run.start', mode: params.runMode, timestamp: params.now() });
  recordAuditEvent('run.start', { mode: params.runMode }, { scope: 'session', severity: 'low' });
}

export function recordLoopRunEnd(params: {
  emitSanitized: (event: LoopEvent) => void;
  runMode: LoopRunMode;
  success: boolean;
  now: () => Date;
  auditMeta?: AuditTrailMeta;
}): void {
  params.emitSanitized({
    type: 'run.end',
    mode: params.runMode,
    success: params.success,
    timestamp: params.now(),
  });
  recordAuditEvent(
    'run.end',
    { mode: params.runMode, success: params.success },
    {
      scope: 'session',
      severity: params.success ? 'low' : 'medium',
      ...params.auditMeta,
    },
  );
}
