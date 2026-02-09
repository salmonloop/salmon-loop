/**
 * Sanitizes any error input (object, string, or mixed) to prevent leakage
 * of sensitive technical data like Zod dumps or stack traces.
 */
export function sanitizeErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';

  // 1. Force convert to string to analyze content regardless of object structure
  let msg = '';
  try {
    msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    msg = String(err);
  }

  // 2. Strict Whitelist Detection
  // Only allow very short, non-technical, localized-style or user-initiated strings
  const isSafeText =
    msg.length < 100 &&
    !msg.includes('error') &&
    !msg.includes('Error') &&
    !msg.includes('failed') &&
    !msg.includes('Exception') &&
    !msg.includes(':') &&
    !msg.includes('{') &&
    !msg.includes('/') &&
    !msg.includes('Unavailable') &&
    !msg.includes('Not Found') &&
    !/at\s+.*:\d+:\d+/.test(msg);

  const isKnownSafe = [
    'User aborted the operation',
    'Operation cancelled',
    'Request timed out',
  ].includes(msg);

  // 3. The Strict Block Rule
  if (!(isSafeText || isKnownSafe) || msg.length > 500) {
    return 'ERR_TECHNICAL_DETAILS_HIDDEN';
  }

  return msg;
}

/**
 * Deeply sanitizes an object to remove sensitive technical data from any nested property.
 * Uses Reflect.ownKeys to catch non-enumerable properties and symbols.
 */
export function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object' || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  const result: Record<string | symbol, any> = {};
  const keys = Reflect.ownKeys(obj);

  for (const key of keys) {
    const value = (obj as any)[key];
    const keyStr = String(key);

    // High risk fields that definitely need string-level sanitization
    if (
      ['responseBody', 'providerMessage', 'message', 'causeMessage', 'details', 'data'].includes(
        keyStr,
      )
    ) {
      if (typeof value === 'string') {
        result[key] = sanitizeErrorMessage(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeObject(value);
      } else {
        result[key] = value;
      }
      continue;
    }

    // Blacklisted fields that contain raw request/response data that should be completely hidden
    if (
      [
        'requestBodyValues',
        'requestBody',
        'headers',
        'responseHeaders',
        'request',
        'stack',
        'url',
      ].includes(keyStr)
    ) {
      result[key] = '[HIDDEN FOR SECURITY]';
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      // Avoid circular references for safety during deep recursion
      try {
        result[key] = sanitizeObject(value);
      } catch {
        result[key] = '[CIRCULAR]';
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Normalizes text while preserving essential characters like hyphens and underscores.
 * Fixed: Removed aggressive [^\w\s] replacement that was causing character loss.
 */
export function normalizeContent(text: string): string {
  return text.trim();
}
