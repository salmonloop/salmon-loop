const SECRET_KEY_REGEX = /(api[-_]?key|authorization|token|secret|password|cookie)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncate(value: string, max = 500): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + '...';
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return truncate(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_REGEX.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(v);
      }
    }
    return out;
  }
  return '[Unserializable]';
}

export function redactJsonString(raw: string): string {
  return truncate(raw, 500);
}

export function redactErrorMessage(raw: string): string {
  return truncate(raw, 500);
}
