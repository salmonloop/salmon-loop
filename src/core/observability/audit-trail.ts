export type AuditSeverity = 'low' | 'medium' | 'high';
export type AuditScope = 'global' | 'repo' | 'user' | 'session';

export interface AuditTrailEvent {
  action: string;
  details: unknown;
  timestamp: string;
  source?: string;
  severity?: AuditSeverity;
  scope?: AuditScope;
  phase?: string;
  correlationId?: string;
}

export interface AuditTrailMeta {
  source?: string;
  severity?: AuditSeverity;
  scope?: AuditScope;
  phase?: string;
  correlationId?: string;
  /**
   * Optional Langfuse sessionId for cross-run aggregation (e.g. chat sessions).
   */
  sessionId?: string;
  /**
   * Optional Langfuse userId for trace attribution.
   */
  userId?: string;
  /**
   * Optional Langfuse observation name override for a specific LLM request.
   * If set, AiSdkLLM will prefer this over `phase` when populating Langfuse headers.
   */
  observationName?: string;
}

const auditTrail: AuditTrailEvent[] = [];
const auditContext: AuditTrailMeta = {};
const DEFAULT_BUFFER_LIMITS = {
  maxEvents: 10000,
  maxBytes: 20 * 1024 * 1024,
};
let bufferLimits = { ...DEFAULT_BUFFER_LIMITS };
let bufferBytes = 0;
let droppedCount = 0;
let droppedSince: string | undefined;

export function setAuditBufferLimits(
  limits?: Partial<{ maxEvents: number; maxBytes: number }>,
): void {
  bufferLimits = {
    maxEvents: limits?.maxEvents ?? DEFAULT_BUFFER_LIMITS.maxEvents,
    maxBytes: limits?.maxBytes ?? DEFAULT_BUFFER_LIMITS.maxBytes,
  };
  bufferBytes = auditTrail.reduce((sum, event) => sum + estimateEventSize(event), 0);
}

function estimateEventSize(event: AuditTrailEvent): number {
  try {
    return Buffer.byteLength(JSON.stringify(event), 'utf-8');
  } catch {
    return 0;
  }
}

function severityRank(severity?: AuditSeverity): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function dropForCapacity(newEvent: AuditTrailEvent, newSize: number): boolean {
  const maxEvents = bufferLimits.maxEvents;
  const maxBytes = bufferLimits.maxBytes;
  const newRank = severityRank(newEvent.severity);

  while (auditTrail.length >= maxEvents || bufferBytes + newSize > maxBytes) {
    if (auditTrail.length === 0) return false;
    let lowestIndex = 0;
    let lowestRank = severityRank(auditTrail[0]?.severity);
    for (let i = 1; i < auditTrail.length; i += 1) {
      const rank = severityRank(auditTrail[i]?.severity);
      if (rank < lowestRank) {
        lowestRank = rank;
        lowestIndex = i;
      }
    }
    if (lowestRank > newRank) {
      return false;
    }
    const [removed] = auditTrail.splice(lowestIndex, 1);
    bufferBytes -= estimateEventSize(removed);
    droppedCount += 1;
    if (!droppedSince) {
      droppedSince = new Date().toISOString();
    }
  }

  return true;
}

export function drainAuditDropStats(): { count: number; since?: string } {
  const snapshot = { count: droppedCount, since: droppedSince };
  droppedCount = 0;
  droppedSince = undefined;
  return snapshot;
}

export function setAuditContext(meta: AuditTrailMeta) {
  Object.assign(auditContext, meta);
}

export function getAuditContext(): AuditTrailMeta {
  return { ...auditContext };
}

export function clearAuditContext() {
  for (const key of Object.keys(auditContext)) {
    delete (auditContext as any)[key];
  }
}

export function recordAuditEvent(action: string, details: unknown, meta?: AuditTrailMeta) {
  const effective: AuditTrailMeta = {
    ...auditContext,
    ...meta,
  };
  if (droppedCount > 0) {
    const dropEvent: AuditTrailEvent = {
      action: 'audit.dropped',
      details: { count: droppedCount, since: droppedSince },
      source: 'audit',
      severity: 'medium',
      scope: effective.scope,
      phase: effective.phase,
      correlationId: effective.correlationId,
      timestamp: new Date().toISOString(),
    };
    const dropSize = estimateEventSize(dropEvent);
    if (dropForCapacity(dropEvent, dropSize)) {
      auditTrail.push(dropEvent);
      bufferBytes += dropSize;
      droppedCount = 0;
      droppedSince = undefined;
    }
  }
  const event: AuditTrailEvent = {
    action,
    details,
    source: effective.source,
    severity: effective.severity,
    scope: effective.scope,
    phase: effective.phase,
    correlationId: effective.correlationId,
    timestamp: new Date().toISOString(),
  };
  const size = estimateEventSize(event);
  if (!dropForCapacity(event, size)) return;
  auditTrail.push(event);
  bufferBytes += size;
}

export function getAuditTrail(): AuditTrailEvent[] {
  return [...auditTrail];
}

export function clearAuditTrail() {
  auditTrail.length = 0;
  bufferBytes = 0;
}
