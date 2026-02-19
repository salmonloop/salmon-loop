function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function deriveRootFromOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlashes(baseUrl);
  return trimmed.replace(/\/v1$/, '');
}

function trimTrailingSlashesFromPathname(value: string): string {
  return value.replace(/\/+$/, '');
}

function stripLangfuseApiSuffix(pathname: string): string {
  // Accept user-provided endpoints like:
  // - /langfuse
  // - /langfuse/
  // - /langfuse/api/public
  // - /langfuse/api/public/ingestion
  // Normalize all of them to a stable prefix where we can append "/api/public/ingestion".
  const p = trimTrailingSlashesFromPathname(pathname || '');
  return p.replace(/\/api\/public(?:\/.*)?$/, '') || '';
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function isKnownPublicProviderHost(hostname: string): boolean {
  // Avoid accidentally sending Langfuse ingestion traffic to public LLM provider hosts.
  // This list is intentionally small and can be extended as needed.
  return (
    hostname === 'api.openai.com' ||
    hostname === 'api.anthropic.com' ||
    hostname === 'generativelanguage.googleapis.com'
  );
}

export interface LangfuseOutcomeProxyResolution {
  enabled: boolean;
  proxyBaseUrl?: string;
  proxyPathPrefix?: string;
  reason?: 'DISABLED' | 'MISSING_PROXY_URL' | 'PUBLIC_PROVIDER_HOST';
}

export function resolveLangfuseOutcomeProxyBaseUrl(input: {
  enabled?: boolean;
  endpoint?: string;
  llmBaseUrl?: string;
}): LangfuseOutcomeProxyResolution {
  const enabled = Boolean(input.enabled);
  if (!enabled) return { enabled: false, reason: 'DISABLED' };

  const endpoint = (input.endpoint || '').trim();
  if (endpoint) {
    try {
      const u = new URL(endpoint);
      const base = trimTrailingSlashes(u.origin);
      const rawPrefix = stripLangfuseApiSuffix(u.pathname);
      const prefix = rawPrefix ? trimTrailingSlashesFromPathname(rawPrefix) : '/langfuse';
      const host = hostnameOf(base);
      if (host && isKnownPublicProviderHost(host)) {
        return { enabled: true, reason: 'PUBLIC_PROVIDER_HOST' };
      }
      return { enabled: true, proxyBaseUrl: base, proxyPathPrefix: prefix };
    } catch {
      // If an invalid URL is provided, treat it as missing so callers can fall back.
      return { enabled: true, reason: 'MISSING_PROXY_URL' };
    }
  }

  const llmBaseUrl = (input.llmBaseUrl || '').trim();
  if (!llmBaseUrl) return { enabled: true, reason: 'MISSING_PROXY_URL' };

  const derived = deriveRootFromOpenAiBaseUrl(llmBaseUrl);
  const host = hostnameOf(derived);
  if (host && isKnownPublicProviderHost(host)) {
    return { enabled: true, reason: 'PUBLIC_PROVIDER_HOST' };
  }

  return { enabled: true, proxyBaseUrl: derived, proxyPathPrefix: '/langfuse' };
}
