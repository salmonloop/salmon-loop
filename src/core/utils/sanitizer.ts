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
    !/at\s+.*:\d+:\d+/.test(msg);

  const isKnownSafe = [
    'User aborted the operation',
    'Operation cancelled',
    'Request timed out',
  ].includes(msg);

  // 3. The Strict Block Rule
  if (!(isSafeText || isKnownSafe) || msg.length > 500) {
    return 'The operation failed due to a technical error. Details have been hidden for security. Please check the audit logs.';
  }

  return msg;
}

/**
 * Normalizes text while preserving essential characters like hyphens and underscores.
 * Fixed: Removed aggressive [^\w\s] replacement that was causing character loss.
 */
export function normalizeContent(text: string): string {
  return text.trim();
}
