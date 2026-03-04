import { describe, expect, it, mock } from 'bun:test';

mock.module('@ai-sdk/openai', () => ({
  createOpenAI: mock(() => ({
    chat: mock((modelId: string) => ({ provider: 'openai', modelId })),
  })),
}));

mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mock(() => ({
    chatModel: mock((modelId: string) => ({ provider: 'compatible', modelId })),
  })),
}));

import {
  createAiSdkChatModel,
  resolveAiSdkModelId,
} from '../../src/core/llm/ai-sdk/provider-factory.js';

describe('ai-sdk provider factory', () => {
  it('resolveAiSdkModelId uses explicit config first', () => {
    process.env.SALMONLOOP_MODEL = 'env-model';
    process.env.S8P_MODEL = 'legacy-model';
    expect(resolveAiSdkModelId('explicit-model')).toBe('explicit-model');
  });

  it('resolveAiSdkModelId falls back to SALMONLOOP_MODEL, then S8P_MODEL, then default', () => {
    delete process.env.SALMONLOOP_MODEL;
    delete process.env.S8P_MODEL;
    expect(resolveAiSdkModelId()).toBe('gpt-4o');

    process.env.S8P_MODEL = 'legacy-model';
    expect(resolveAiSdkModelId()).toBe('legacy-model');

    process.env.SALMONLOOP_MODEL = 'env-model';
    expect(resolveAiSdkModelId()).toBe('env-model');
  });

  it('createAiSdkChatModel builds openai provider with resolved auth + baseURL', async () => {
    process.env.SALMONLOOP_API_KEY = 'env-key';
    const model = createAiSdkChatModel(
      {
        clientPackage: '@ai-sdk/openai',
        baseUrl: 'https://api.example.com/v1',
      },
      'gpt-test',
    );

    expect(model).toEqual({ provider: 'openai', modelId: 'gpt-test' });
  });

  it('createAiSdkChatModel builds openai-compatible provider with bearer auth header', () => {
    delete process.env.SALMONLOOP_API_KEY;
    const model = createAiSdkChatModel(
      {
        clientPackage: '@ai-sdk/openai-compatible',
        baseUrl: 'https://compat.example.com/v1',
        providerName: 'compat',
        apiKey: 'explicit-key',
      },
      'gpt-compat',
    );

    expect(model).toEqual({ provider: 'compatible', modelId: 'gpt-compat' });
  });
});
