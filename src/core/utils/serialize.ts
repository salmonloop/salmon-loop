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
