import { DEFAULT_AUDIT_BUFFER } from '../defaults.js';
import { firstNonEmpty, parseBoolEnv } from '../resolve-env.js';
import type {
  ApiKeySource,
  ConfigFileV1,
  LangfuseObservabilityConfigV1,
  ResolvedConfig,
} from '../types.js';

function resolveLangfuseApiKey(inlineKey: string | null | undefined): {
  key?: string;
  source: ApiKeySource;
} {
  const inline = firstNonEmpty(inlineKey);
  if (inline) return { key: inline, source: 'inline' };

  const envKey = firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_API_KEY);
  if (envKey) return { key: envKey, source: 'env' };

  return { source: 'missing' };
}

export function resolveLangfuseObservability(
  raw?: ConfigFileV1,
): ResolvedConfig['observability']['langfuse'] {
  const cfg: LangfuseObservabilityConfigV1 | undefined = raw?.observability?.langfuse;

  const enabled = parseBoolEnv(process.env.SALMONLOOP_LANGFUSE) ?? cfg?.enabled ?? false;
  const outcome = parseBoolEnv(process.env.SALMONLOOP_LANGFUSE_OUTCOME) ?? cfg?.outcome ?? false;

  // Prefer explicit proxy base URL env override (backwards-compatible). This may be either:
  // - a root proxy URL (e.g. "https://api.s8p.io"), or
  // - a full /langfuse endpoint (e.g. "https://api.s8p.io/langfuse/").
  const endpoint =
    firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_PROXY_URL) ?? firstNonEmpty(cfg?.endpoint);

  const resolvedApiKey = resolveLangfuseApiKey(cfg?.apiKey);

  const sessionId =
    firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_SESSION_ID) ?? firstNonEmpty(cfg?.sessionId);

  const userId =
    firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_USER_ID) ?? firstNonEmpty(cfg?.userId);

  return {
    enabled,
    outcome,
    endpoint,
    apiKey: resolvedApiKey.key,
    apiKeySource: resolvedApiKey.source,
    sessionId,
    userId,
  };
}

export function resolveAuditBuffer(
  raw?: ConfigFileV1,
): ResolvedConfig['observability']['audit']['buffer'] {
  const cfg = raw?.observability?.audit?.buffer;
  return {
    maxEvents: cfg?.maxEvents ?? DEFAULT_AUDIT_BUFFER.maxEvents,
    maxBytes: cfg?.maxBytes ?? DEFAULT_AUDIT_BUFFER.maxBytes,
    droppedWarn: cfg?.droppedWarn ?? DEFAULT_AUDIT_BUFFER.droppedWarn,
  };
}

export function resolveAuditScope(
  raw?: ConfigFileV1,
): ResolvedConfig['observability']['audit']['scope'] {
  const scope = raw?.observability?.audit?.scope;
  return scope === 'user' ? 'user' : 'repo';
}
