import { DEFAULT_REDACTION_CONFIG } from '../defaults.js';
import type { ConfigFileV1, ResolvedConfig } from '../types.js';

export function resolveRedactionConfig(
  raw?: ConfigFileV1,
): ResolvedConfig['security']['redaction'] {
  const cfg = raw?.security?.redaction;
  return {
    enabled: cfg?.enabled ?? DEFAULT_REDACTION_CONFIG.enabled,
    mark: cfg?.mark ?? DEFAULT_REDACTION_CONFIG.mark,
    maxDepth: cfg?.maxDepth ?? DEFAULT_REDACTION_CONFIG.maxDepth,
    keyAllowlist: cfg?.keyAllowlist,
    keyDenylist: cfg?.keyDenylist,
    patterns: cfg?.patterns,
    disableDefaults: cfg?.disableDefaults,
  };
}
