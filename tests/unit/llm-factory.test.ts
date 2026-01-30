import { describe, expect, it } from 'vitest';

import type { ResolvedLlmProvider } from '../../src/core/config/types.js';
import { createRuntimeLlm } from '../../src/core/llm/factory.js';
import { AiSdkLLM, OpenAILLM, StubLLM } from '../../src/core/llm.js';

function baseResolved(): ResolvedLlmProvider {
  return {
    id: 'openaiMain',
    type: 'openai-compatible',
    clientPackage: undefined,
    api: {
      apiKey: 'test-key',
      apiKeySource: 'inline',
      baseUrl: 'https://example.com/v1',
      headers: {},
      timeoutMs: 60000,
    },
    models: {
      selectedModelId: 'gpt-test',
      selectedModelSlot: 'default',
    },
  };
}

describe('LLM factory', () => {
  it('uses AiSdkLLM when client.package is supported', () => {
    const resolved = baseResolved();
    resolved.clientPackage = '@ai-sdk/openai-compatible';

    const result = createRuntimeLlm(resolved);
    expect(result.backend).toBe('ai-sdk');
    expect(result.warnings).toEqual([]);
    expect(result.llm).toBeInstanceOf(AiSdkLLM);
  });

  it('falls back to OpenAILLM when client.package is not set', () => {
    const resolved = baseResolved();
    resolved.clientPackage = undefined;

    const result = createRuntimeLlm(resolved);
    expect(result.backend).toBe('openai');
    expect(result.warnings).toEqual([]);
    expect(result.llm).toBeInstanceOf(OpenAILLM);
  });

  it('warns and falls back to OpenAILLM when client.package is unsupported', () => {
    const resolved = baseResolved();
    resolved.clientPackage = '@unknown/provider';

    const result = createRuntimeLlm(resolved);
    expect(result.backend).toBe('openai');
    expect(result.warnings).toContain('CLIENT_PACKAGE_NOT_SUPPORTED');
    expect(result.llm).toBeInstanceOf(OpenAILLM);
  });

  it('uses StubLLM when apiKey is missing', () => {
    const resolved = baseResolved();
    resolved.api.apiKey = undefined;

    const result = createRuntimeLlm(resolved);
    expect(result.backend).toBe('stub');
    expect(result.warnings).toContain('API_KEY_MISSING');
    expect(result.llm).toBeInstanceOf(StubLLM);
  });

  it('uses StubLLM for non-openai providers', () => {
    const resolved = baseResolved();
    resolved.type = 'anthropic';

    const result = createRuntimeLlm(resolved);
    expect(result.backend).toBe('stub');
    expect(result.warnings).toContain('PROVIDER_NOT_SUPPORTED');
    expect(result.llm).toBeInstanceOf(StubLLM);
  });
});
