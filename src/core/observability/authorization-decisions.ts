import type { AuthorizationDecisionRecord } from '../types/authorization.js';

import type { AuditTrailEvent } from './audit-trail.js';
import { getAuditTrail } from './audit-trail.js';

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map(safeString).filter((v): v is string => typeof v === 'string');
  return out.length > 0 ? out : undefined;
}

export function extractAuthorizationDecisionsFromAuditTrail(
  auditTrail: AuditTrailEvent[],
): AuthorizationDecisionRecord[] {
  const decisions: AuthorizationDecisionRecord[] = [];

  for (const event of auditTrail) {
    if (!event || typeof event !== 'object') continue;
    if (event.action !== 'authorization.decision') continue;
    const details = event.details;
    if (!details || typeof details !== 'object') continue;

    const callId = safeString((details as any).callId);
    const toolName = safeString((details as any).toolName);
    const phase = safeString((details as any).phase) ?? safeString((event as any).phase);
    const outcome = safeString((details as any).outcome);

    if (!callId || !toolName || !phase || !outcome) continue;

    decisions.push({
      callId,
      toolName,
      phase: phase as any,
      outcome: outcome as any,
      source: (safeString((details as any).source) ?? 'unknown') as any,
      reason: safeString((details as any).reason),
      ttlMs: safeNumber((details as any).ttlMs),
      persist: safeString((details as any).persist) as any,
      riskLevel: safeString((details as any).riskLevel),
      sideEffects: safeStringArray((details as any).sideEffects),
      timestamp: safeString(event.timestamp) ?? new Date().toISOString(),
    });
  }

  return decisions;
}

export function getAuthorizationDecisionsFromAuditTrail(): AuthorizationDecisionRecord[] {
  return extractAuthorizationDecisionsFromAuditTrail(getAuditTrail());
}
