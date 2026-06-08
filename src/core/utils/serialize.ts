export interface SafeStringifyOptions {
  /** Pretty-print with given number of spaces (default: 0 = compact) */
  indent?: number;
  /** Truncate output to this many characters (default: 0 = no truncation) */
  maxLength?: number;
}

/**
 * Safely serialize a value to JSON string.
 * Returns '[Unserializable]' if JSON.stringify throws and String() also fails.
 */
export function safeStringify(value: unknown, options?: SafeStringifyOptions): string {
  try {
    const raw = JSON.stringify(value, null, options?.indent);
    if (options?.maxLength && raw.length > options.maxLength) {
      return `${raw.slice(0, options.maxLength)}...`;
    }
    return raw;
  } catch {
    try {
      return String(value);
    } catch {
      return '[Unserializable]';
    }
  }
}

/**
 * Type guard: narrow an unknown value to Record<string, unknown>.
 * Returns false for arrays, primitives, null, and undefined.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Narrow an unknown value to a Record<string, unknown>.
 * Returns an empty object for non-object inputs (arrays, primitives, null, undefined).
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
