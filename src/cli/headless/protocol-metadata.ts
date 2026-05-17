export const HEADLESS_SCHEMA_VERSION = 1;
export const HEADLESS_NATIVE_STREAM_PROTOCOL_VERSION = 1;

export interface HeadlessWarning {
  code: string;
  message: string;
  source: string;
  severity: 'warning';
}

export function normalizeHeadlessWarnings(
  warnings?: readonly HeadlessWarning[],
): HeadlessWarning[] {
  if (!warnings?.length) return [];

  const seen = new Set<string>();
  const normalized: HeadlessWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.source}:${warning.code}:${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      code: warning.code,
      message: warning.message,
      source: warning.source,
      severity: warning.severity,
    });
  }
  return normalized;
}
