function parseBoolEnv(value: string | undefined): boolean {
  const raw = (value || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function deriveRootFromOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlashes(baseUrl);
  return trimmed.replace(/\/v1$/, '');
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
  reason?: 'DISABLED' | 'MISSING_PROXY_URL' | 'PUBLIC_PROVIDER_HOST';
}

export function resolveLangfuseOutcomeProxyBaseUrl(input: {
  llmBaseUrl?: string;
}): LangfuseOutcomeProxyResolution {
  const enabled = parseBoolEnv(process.env.SALMONLOOP_LANGFUSE_OUTCOME);
  if (!enabled) return { enabled: false, reason: 'DISABLED' };

  const explicit = (process.env.SALMONLOOP_LANGFUSE_PROXY_URL || '').trim();
  if (explicit) {
    return { enabled: true, proxyBaseUrl: trimTrailingSlashes(explicit) };
  }

  const llmBaseUrl = (input.llmBaseUrl || '').trim();
  if (!llmBaseUrl) return { enabled: true, reason: 'MISSING_PROXY_URL' };

  const derived = deriveRootFromOpenAiBaseUrl(llmBaseUrl);
  const host = hostnameOf(derived);
  if (host && isKnownPublicProviderHost(host)) {
    return { enabled: true, reason: 'PUBLIC_PROVIDER_HOST' };
  }

  return { enabled: true, proxyBaseUrl: derived };
}
