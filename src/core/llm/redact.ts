const SECRET_KEY_REGEX = /(api[-_]?key|authorization|token|secret|password|cookie)/i;
const STRING_SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /(authorization\s*:\s*bearer\s+)[^\s'",`]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    pattern: /\bbearer\s+[a-z0-9._~+/=-]{16,}\b/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    pattern: /\bsk-[a-z0-9_-]{16,}\b/gi,
    replacement: '[REDACTED]',
  },
  {
    pattern: /\b(api[-_]?key|token|secret|password|cookie)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s'",`]+)/gi,
    replacement: '$1=[REDACTED]',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncate(value: string, max = 500): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + '...';
}

function redactString(value: string): string {
  let redacted = value;
  for (const { pattern, replacement } of STRING_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return truncate(redacted, 500);
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
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
  return redactString(raw);
}

export function redactErrorMessage(raw: string): string {
  return redactString(raw);
}
