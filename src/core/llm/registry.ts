import type { ResolvedLlmProvider } from '../config/types.js';
import type { LLM } from '../types/llm.js';

import { AiSdkLLM, type AiSdkClientPackage } from './ai-sdk.js';
import { StubLLM } from './openai.js';

export type LlmBackend = 'ai-sdk' | 'stub';

export type LlmFactoryWarningCode =
  | 'API_KEY_MISSING'
  | 'PROVIDER_NOT_SUPPORTED'
  | 'CLIENT_PACKAGE_NOT_SUPPORTED';

export interface CreateRuntimeLlmOptions {
  langfuseEnabled?: boolean;
}

export interface CreateRuntimeLlmResult {
  llm: LLM;
  backend: LlmBackend;
  warnings: LlmFactoryWarningCode[];
}

export interface LlmAdapterKey {
  providerType: string;
  clientPackage?: string;
}

export type LlmAdapterFactory = (
  resolved: ResolvedLlmProvider,
  options?: CreateRuntimeLlmOptions,
) => CreateRuntimeLlmResult;

function keyToString(key: LlmAdapterKey): string {
  return `${key.providerType}::${key.clientPackage || ''}`;
}

export class LlmAdapterRegistry {
  private readonly map = new Map<string, LlmAdapterFactory>();

  register(key: LlmAdapterKey, factory: LlmAdapterFactory): void {
    this.map.set(keyToString(key), factory);
  }

  resolve(key: LlmAdapterKey): LlmAdapterFactory | undefined {
    return this.map.get(keyToString(key));
  }

  isClientPackageAllowed(providerType: string, clientPackage: string): boolean {
    for (const k of this.map.keys()) {
      const [t, pkg] = k.split('::');
      if (t === providerType && pkg === clientPackage) return true;
    }
    return false;
  }
}

export function createDefaultLlmRegistry(): LlmAdapterRegistry {
  const reg = new LlmAdapterRegistry();

  const buildAiSdk = (clientPackage: AiSdkClientPackage): LlmAdapterFactory => {
    return (resolved, options) => {
      const warnings: LlmFactoryWarningCode[] = [];

      if (!resolved.api.apiKey) {
        warnings.push('API_KEY_MISSING');
        return { llm: new StubLLM(), backend: 'stub', warnings };
      }

      return {
        llm: new AiSdkLLM({
          clientPackage,
          providerName: resolved.id,
          apiKey: resolved.api.apiKey,
          baseUrl: resolved.api.baseUrl,
          modelId: resolved.models.selectedModelId,
          headers: resolved.api.headers,
          timeoutMs: resolved.api.timeoutMs,
          langfuseEnabled: options?.langfuseEnabled,
        }),
        backend: 'ai-sdk',
        warnings,
      };
    };
  };

  reg.register(
    { providerType: 'openai', clientPackage: '@ai-sdk/openai' },
    buildAiSdk('@ai-sdk/openai'),
  );
  reg.register(
    { providerType: 'openai-compatible', clientPackage: '@ai-sdk/openai-compatible' },
    buildAiSdk('@ai-sdk/openai-compatible'),
  );

  // Legacy/default client path (no client.package). This is intentionally not expressed as a registry entry.
  // The factory decides when to fall back to a stable stub adapter based on provider family and apiKey.

  return reg;
}

export function createDefaultOpenAiFallback(
  resolved: ResolvedLlmProvider,
  options?: CreateRuntimeLlmOptions,
): CreateRuntimeLlmResult {
  const warnings: LlmFactoryWarningCode[] = [];

  if (!resolved.api.apiKey) {
    warnings.push('API_KEY_MISSING');
    return { llm: new StubLLM(), backend: 'stub', warnings };
  }

  if (resolved.type !== 'openai' && resolved.type !== 'openai-compatible') {
    warnings.push('PROVIDER_NOT_SUPPORTED');
    return { llm: new StubLLM(), backend: 'stub', warnings };
  }

  // Prefer AI SDK for the default path.
  const clientPackage: AiSdkClientPackage =
    resolved.type === 'openai' ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible';

  return {
    llm: new AiSdkLLM({
      clientPackage,
      providerName: resolved.id,
      apiKey: resolved.api.apiKey,
      baseUrl: resolved.api.baseUrl,
      modelId: resolved.models.selectedModelId,
      headers: resolved.api.headers,
      timeoutMs: resolved.api.timeoutMs,
      langfuseEnabled: options?.langfuseEnabled,
    }),
    backend: 'ai-sdk',
    warnings,
  };
}
