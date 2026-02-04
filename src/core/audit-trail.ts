export interface AuditTrailEvent {
  action: string;
  details: unknown;
  timestamp: string;
  source?: string;
}

const auditTrail: AuditTrailEvent[] = [];

export function recordAuditEvent(action: string, details: unknown, source?: string) {
  auditTrail.push({
    action,
    details,
    source,
    timestamp: new Date().toISOString(),
  });
}

export function getAuditTrail(): AuditTrailEvent[] {
  return [...auditTrail];
}

export function clearAuditTrail() {
  auditTrail.length = 0;
}
