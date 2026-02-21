import { LiteLlmLangfuseOutcomeReporter } from '../../../integrations/langfuse/litellm-langfuse-outcome-reporter.js';
import { resolveLangfuseOutcomeProxyBaseUrl } from '../../../integrations/langfuse/outcome-proxy.js';

export function createOutcomeReporter(params: {
  enabled: boolean;
  endpoint?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  proxyApiKeyEnv?: string;
  proxyPathPrefix?: string;
  sessionId?: string;
}) {
  const resolved = resolveLangfuseOutcomeProxyBaseUrl({
    enabled: params.enabled,
    endpoint: params.endpoint,
    llmBaseUrl: params.llmBaseUrl,
  });
  if (!resolved.enabled || !resolved.proxyBaseUrl) return undefined;

  const proxyApiKey = (params.proxyApiKeyEnv || '').trim() || params.llmApiKey;
  return new LiteLlmLangfuseOutcomeReporter({
    proxyBaseUrl: resolved.proxyBaseUrl,
    proxyPathPrefix: resolved.proxyPathPrefix,
    litellmApiKey: proxyApiKey,
  });
}
