import type { ResolvedLlmProvider } from '../config/types.js';
import type { SubAgentLlmFactory } from '../sub-agent/types.js';
import type { LLM } from '../types/llm.js';

import { AiSdkLLM, type AiSdkClientPackage } from './ai-sdk.js';
import { StubLLM } from './openai.js';

/**
 * Model alias → concrete model ID mapping.
 *
 * These follow the Anthropic model naming conventions.
 * Providers that don't support these IDs will fall back to StubLLM.
 */
const MODEL_ALIAS_MAP: Record<string, string> = {
  haiku: 'claude-3-5-haiku-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

function resolveModelId(alias: string): string {
  return MODEL_ALIAS_MAP[alias] ?? alias;
}

/**
 * Create a SubAgentLlmFactory that produces model-specific LLM instances
 * from a base provider configuration.
 *
 * The factory reuses the parent provider's connection settings (API key,
 * base URL, headers) and only overrides the model ID.
 */
export function createSubAgentLlmFactory(baseProvider: ResolvedLlmProvider): SubAgentLlmFactory {
  return (modelAlias: string): LLM | undefined => {
    const modelId = resolveModelId(modelAlias);

    if (baseProvider.type === 'openai-compatible' || baseProvider.type === 'openai') {
      const clientPackage: AiSdkClientPackage =
        baseProvider.clientPackage === '@ai-sdk/openai'
          ? '@ai-sdk/openai'
          : '@ai-sdk/openai-compatible';

      if (!baseProvider.api.apiKey) {
        return new StubLLM();
      }

      return new AiSdkLLM({
        clientPackage,
        providerName: baseProvider.id,
        apiKey: baseProvider.api.apiKey,
        baseUrl: baseProvider.api.baseUrl,
        modelId,
        headers: baseProvider.api.headers,
        timeoutMs: baseProvider.api.timeoutMs,
        capabilities: baseProvider.capabilities,
      });
    }

    return undefined;
  };
}
