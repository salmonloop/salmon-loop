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

  // 2. Aggressive heuristic detection
  const isZod =
    msg.includes('ZodError') || msg.includes('invalid_union') || msg.includes('invalid_type');
  const hasStackTrace = /at\s+.*:\d+:\d+/.test(msg) || msg.includes('    at ');
  const isJsonDump = /^\s*\{.*"/.test(msg) || msg.includes('"path": [');
  const isAiSdkError =
    msg.includes('vercel.ai.error') ||
    (typeof err === 'object' &&
      err !== null &&
      Object.getOwnPropertySymbols(err).some((s) => s.toString().includes('ai.error')));

  // 3. The Block Rule
  if (isZod || hasStackTrace || isJsonDump || isAiSdkError || msg.length > 800) {
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
