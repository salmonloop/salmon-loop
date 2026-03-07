import { LiteLlmLangfuseOutcomeReporter } from '../../integrations/langfuse/litellm-langfuse-outcome-reporter.js';
import { resolveLangfuseOutcomeProxyBaseUrl } from '../../integrations/langfuse/outcome-proxy.js';

export function createOutcomeReporter(params: {
  enabled: boolean;
  endpoint?: string;
  llmBaseUrl?: string;
  langfuseApiKey?: string;
}) {
  const resolved = resolveLangfuseOutcomeProxyBaseUrl({
    enabled: params.enabled,
    endpoint: params.endpoint,
    llmBaseUrl: params.llmBaseUrl,
  });
  if (!resolved.enabled || !resolved.proxyBaseUrl) return undefined;

  return new LiteLlmLangfuseOutcomeReporter({
    proxyBaseUrl: resolved.proxyBaseUrl,
    proxyPathPrefix: resolved.proxyPathPrefix,
    litellmApiKey: params.langfuseApiKey,
  });
}
