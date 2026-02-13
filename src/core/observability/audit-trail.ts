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
}

const auditTrail: AuditTrailEvent[] = [];
const auditContext: AuditTrailMeta = {};

export function setAuditContext(meta: AuditTrailMeta) {
  Object.assign(auditContext, meta);
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
  auditTrail.push({
    action,
    details,
    source: effective.source,
    severity: effective.severity,
    scope: effective.scope,
    phase: effective.phase,
    correlationId: effective.correlationId,
    timestamp: new Date().toISOString(),
  });
}

export function getAuditTrail(): AuditTrailEvent[] {
  return [...auditTrail];
}

export function clearAuditTrail() {
  auditTrail.length = 0;
}
