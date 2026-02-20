import type { AuthorizationSourceSummary } from '../../../types/index.js';

export function buildAuthorizationSummary(
  logs: unknown[] | undefined,
): AuthorizationSourceSummary | null {
  if (!logs || logs.length === 0) return null;

  const summary: AuthorizationSourceSummary = {
    auto: 0,
    allowlist: 0,
    user: 0,
    cache: 0,
    cli: 0,
  };
  let hasEntries = false;

  for (const entry of logs) {
    if (!entry || (entry as any).eventType !== 'authorization') continue;
    const source = (entry as any).authSource;
    if (source === 'auto') {
      summary.auto += 1;
      hasEntries = true;
    } else if (source === 'allowlist') {
      summary.allowlist += 1;
      hasEntries = true;
    } else if (source === 'user') {
      summary.user += 1;
      hasEntries = true;
    } else if (source === 'cache') {
      summary.cache += 1;
      hasEntries = true;
    } else if (source === 'cli') {
      summary.cli += 1;
      hasEntries = true;
    }
  }

  return hasEntries ? summary : null;
}
