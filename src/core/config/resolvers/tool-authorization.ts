import { DEFAULT_TOOL_AUTH } from '../defaults.js';
import type { ConfigFileV1, ToolAuthorizationConfig } from '../types.js';

export function resolveToolAuthorization(raw?: ConfigFileV1): ToolAuthorizationConfig {
  const config = raw?.toolAuthorization;
  return {
    sessionTtlMs: config?.sessionTtlMs ?? DEFAULT_TOOL_AUTH.sessionTtlMs,
    autoAllowRisk: {
      low: config?.autoAllowRisk?.low ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.low,
      medium: config?.autoAllowRisk?.medium ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.medium,
      high: config?.autoAllowRisk?.high ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.high,
    },
    nonInteractive: {
      strategy:
        config?.nonInteractive?.strategy ?? DEFAULT_TOOL_AUTH.nonInteractive?.strategy ?? 'deny',
      command: config?.nonInteractive?.command,
      mcp: config?.nonInteractive?.mcp,
    },
    allowlist: {
      repoFile: config?.allowlist?.repoFile ?? DEFAULT_TOOL_AUTH.allowlist?.repoFile,
      userFile: config?.allowlist?.userFile ?? DEFAULT_TOOL_AUTH.allowlist?.userFile,
      summary: {
        every: config?.allowlist?.summary?.every ?? DEFAULT_TOOL_AUTH.allowlist?.summary?.every,
        minIntervalMs:
          config?.allowlist?.summary?.minIntervalMs ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.minIntervalMs,
        failureMinIntervalMs:
          config?.allowlist?.summary?.failureMinIntervalMs ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.failureMinIntervalMs,
        maxToolStats:
          config?.allowlist?.summary?.maxToolStats ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.maxToolStats,
        maxPathStats:
          config?.allowlist?.summary?.maxPathStats ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.maxPathStats,
      },
      matching: {
        denySideEffects:
          config?.allowlist?.matching?.denySideEffects ??
          DEFAULT_TOOL_AUTH.allowlist?.matching?.denySideEffects,
        allowSideEffects:
          config?.allowlist?.matching?.allowSideEffects ??
          DEFAULT_TOOL_AUTH.allowlist?.matching?.allowSideEffects,
      },
    },
  };
}
