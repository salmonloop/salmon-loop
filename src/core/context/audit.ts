import { recordAuditEvent, type AuditTrailMeta } from '../observability/audit-trail.js';

const DEFAULT_LIMITS = {
  maxDepth: 4,
  maxStringChars: 2000,
  maxArrayItems: 50,
  maxObjectKeys: 50,
} as const;

const TRUNCATED = '[Truncated]' as const;
const CIRCULAR = '[Circular]' as const;

function sanitizeValue(value: unknown, state: { depth: number; seen: WeakSet<object> }): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length <= DEFAULT_LIMITS.maxStringChars
      ? value
      : value.slice(0, DEFAULT_LIMITS.maxStringChars);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);

  if (state.depth >= DEFAULT_LIMITS.maxDepth) return TRUNCATED;

  if (Array.isArray(value)) {
    const next = value.slice(0, DEFAULT_LIMITS.maxArrayItems);
    return next.map((v) => sanitizeValue(v, { depth: state.depth + 1, seen: state.seen }));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (state.seen.has(obj)) return CIRCULAR;
    state.seen.add(obj);

    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj).slice(0, DEFAULT_LIMITS.maxObjectKeys);
    for (const k of keys) {
      out[k] = sanitizeValue(obj[k], { depth: state.depth + 1, seen: state.seen });
    }
    return out;
  }

  return TRUNCATED;
}

export function sanitizeAuditDetails(details: unknown): unknown {
  return sanitizeValue(details, { depth: 0, seen: new WeakSet<object>() });
}

export function recordContextAuditEvent(action: string, details: unknown, meta?: AuditTrailMeta) {
  recordAuditEvent(action, sanitizeAuditDetails(details), meta);
}
