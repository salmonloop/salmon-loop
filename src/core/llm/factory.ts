import type { ResolvedLlmProvider } from '../config/types.js';
import type { LLM } from '../types.js';

import { AiSdkLLM } from './ai-sdk.js';
import { OpenAILLM, StubLLM } from './openai.js';

export type LlmBackend = 'ai-sdk' | 'openai' | 'stub';

export type LlmFactoryWarningCode =
  | 'API_KEY_MISSING'
  | 'PROVIDER_NOT_SUPPORTED'
  | 'CLIENT_PACKAGE_NOT_SUPPORTED';

export interface CreateRuntimeLlmResult {
  llm: LLM;
  backend: LlmBackend;
  warnings: LlmFactoryWarningCode[];
}

function isOpenAiFamily(type: string): boolean {
  return type === 'openai' || type === 'openai-compatible';
}

function isSupportedAiSdkClientPackage(
  pkg: string | undefined,
): pkg is '@ai-sdk/openai' | '@ai-sdk/openai-compatible' {
  return pkg === '@ai-sdk/openai' || pkg === '@ai-sdk/openai-compatible';
}

export function createRuntimeLlm(resolved: ResolvedLlmProvider): CreateRuntimeLlmResult {
  const warnings: LlmFactoryWarningCode[] = [];

  if (!resolved.api.apiKey) {
    warnings.push('API_KEY_MISSING');
    return { llm: new StubLLM(), backend: 'stub', warnings };
  }

  if (!isOpenAiFamily(resolved.type)) {
    warnings.push('PROVIDER_NOT_SUPPORTED');
    return { llm: new StubLLM(), backend: 'stub', warnings };
  }

  if (resolved.clientPackage && !isSupportedAiSdkClientPackage(resolved.clientPackage)) {
    warnings.push('CLIENT_PACKAGE_NOT_SUPPORTED');
  }

  if (isSupportedAiSdkClientPackage(resolved.clientPackage)) {
    return {
      llm: new AiSdkLLM({
        clientPackage: resolved.clientPackage,
        providerName: resolved.id,
        apiKey: resolved.api.apiKey,
        baseUrl: resolved.api.baseUrl,
        modelId: resolved.models.selectedModelId,
        headers: resolved.api.headers,
      }),
      backend: 'ai-sdk',
      warnings,
    };
  }

  return {
    llm: new OpenAILLM({
      apiKey: resolved.api.apiKey,
      baseUrl: resolved.api.baseUrl,
      modelId: resolved.models.selectedModelId,
    }),
    backend: 'openai',
    warnings,
  };
}
