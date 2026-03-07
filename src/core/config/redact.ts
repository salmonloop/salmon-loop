import type { ConfigFileV1 } from './types.js';

export function redactConfigForPrint(config: ConfigFileV1): ConfigFileV1 {
  const cloned: ConfigFileV1 = JSON.parse(JSON.stringify(config));
  const providers = cloned.llm?.providers;
  if (providers) {
    for (const p of Object.values(providers)) {
      if (p.api?.apiKey) {
        p.api.apiKey = '[REDACTED]';
      }
    }
  }

  if (cloned.observability?.langfuse?.apiKey) {
    cloned.observability.langfuse.apiKey = '[REDACTED]';
  }

  return cloned;
}
