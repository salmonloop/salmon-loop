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

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function extractAuthorizationDecisionsFromAuditTrail(
  auditTrail: AuditTrailEvent[],
): AuthorizationDecisionRecord[] {
  const decisions: AuthorizationDecisionRecord[] = [];

  for (const event of auditTrail) {
    if (!event || typeof event !== 'object') continue;
    if (event.action !== 'authorization.decision') continue;
    if (!event.details || typeof event.details !== 'object') continue;

    const d = asRecord(event.details);
    const callId = safeString(d.callId);
    const toolName = safeString(d.toolName);
    const phase = safeString(d.phase) ?? safeString(event.phase);
    const outcome = safeString(d.outcome);

    if (!callId || !toolName || !phase || !outcome) continue;

    decisions.push({
      callId,
      toolName,
      phase: phase as AuthorizationDecisionRecord['phase'],
      outcome: outcome as AuthorizationDecisionRecord['outcome'],
      source: (safeString(d.source) ?? 'unknown') as AuthorizationDecisionRecord['source'],
      reason: safeString(d.reason),
      ttlMs: safeNumber(d.ttlMs),
      persist: safeString(d.persist) as AuthorizationDecisionRecord['persist'],
      riskLevel: safeString(d.riskLevel),
      sideEffects: safeStringArray(d.sideEffects),
      timestamp: safeString(event.timestamp) ?? new Date().toISOString(),
    });
  }

  return decisions;
}

export function getAuthorizationDecisionsFromAuditTrail(): AuthorizationDecisionRecord[] {
  return extractAuthorizationDecisionsFromAuditTrail(getAuditTrail());
}
