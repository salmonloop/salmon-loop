import type { TokenUsage } from '../types/usage.js';

import type { AuditTrailEvent } from './audit-trail.js';
import { getAuditTrail } from './audit-trail.js';

function safeFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function extractTokenUsageFromAuditTrail(auditTrail: AuditTrailEvent[]): TokenUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of auditTrail) {
    if (!event || typeof event !== 'object') continue;
    if (event.action !== 'llm.usage') continue;

    const details = event.details;
    if (!details || typeof details !== 'object') continue;

    const promptTokens = safeFiniteNumber((details as any).promptTokens);
    const completionTokens = safeFiniteNumber((details as any).completionTokens);

    if (typeof promptTokens === 'number') inputTokens += promptTokens;
    if (typeof completionTokens === 'number') outputTokens += completionTokens;
  }

  if (inputTokens === 0 && outputTokens === 0) return null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function getTokenUsageFromAuditTrail(): TokenUsage | null {
  return extractTokenUsageFromAuditTrail(getAuditTrail());
}
