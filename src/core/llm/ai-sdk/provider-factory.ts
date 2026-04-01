import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { resolveBaseUrl } from '../base-url.js';

export interface AiSdkProviderConfig {
  clientPackage: '@ai-sdk/openai' | '@ai-sdk/openai-compatible';
  providerName?: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

function toProviderOptionsKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) return 'openaiCompatible';

  return normalized
    .replace(/[-_\s]+(.)?/g, (_, char: string | undefined) => (char ? char.toUpperCase() : ''))
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

export function resolveAiSdkModelId(modelId?: string): string {
  return modelId || process.env.SALMONLOOP_MODEL || process.env.S8P_MODEL || 'gpt-4o';
}

export function resolveAiSdkProviderOptionsKey(cfg: AiSdkProviderConfig): string {
  if (cfg.clientPackage === '@ai-sdk/openai') {
    return 'openai';
  }

  return toProviderOptionsKey(cfg.providerName || 'openaiCompatible');
}

export function createAiSdkChatModel(cfg: AiSdkProviderConfig, modelId: string): any {
  if (cfg.clientPackage === '@ai-sdk/openai') {
    const provider = createOpenAI({
      apiKey: cfg.apiKey ?? process.env.SALMONLOOP_API_KEY ?? process.env.S8P_API_KEY,
      baseURL: resolveBaseUrl(cfg.baseUrl),
      headers: cfg.headers,
    });

    // Prefer chat API to preserve existing tool-call loop semantics.
    return provider.chat(modelId);
  }

  const headers: Record<string, string> = { ...(cfg.headers || {}) };
  const apiKey = cfg.apiKey ?? process.env.SALMONLOOP_API_KEY ?? process.env.S8P_API_KEY;
  if (apiKey && !headers.Authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const provider = createOpenAICompatible({
    name: cfg.providerName || 'openai-compatible',
    baseURL: resolveBaseUrl(cfg.baseUrl) ?? '',
    headers,
  });

  return provider.chatModel(modelId);
}
