import { getLogger } from '../observability/logger.js';

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
  } catch (error) {
    getLogger().debug(
      `[Serialize] JSON.stringify failed, falling back to String(): ${error instanceof Error ? error.message : String(error)}`,
    );
    try {
      return String(value);
    } catch (innerError) {
      getLogger().debug(
        `[Serialize] String() conversion also failed: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
      );
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

/**
 * Extract a string value from a record by key.
 * Returns null if the key doesn't exist or the value isn't a string.
 */
export function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Extract a nested record from a record by key.
 * Returns null if the key doesn't exist or the value isn't a record.
 */
export function getRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

/**
 * Extract a human-readable error message from an unknown thrown value.
 * Handles Error instances, strings, and falls back to String(value).
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
