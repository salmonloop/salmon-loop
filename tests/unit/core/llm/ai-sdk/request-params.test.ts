import { describe, expect, it } from 'bun:test';

import { buildAiSdkRequestParams } from '../../../../../src/core/llm/ai-sdk/request-params.js';

describe('buildAiSdkRequestParams', () => {
  it('injects OpenAI-compatible cache hints into providerOptions', () => {
    const params = buildAiSdkRequestParams({
      model: { id: 'model' },
      messages: [],
      options: {
        providerHints: {
          openAICacheHint: 'cache:{"namespace":"plan","components":["ctx-123"]}',
        },
      } as any,
      headers: {},
      abortSignal: new AbortController().signal,
      providerOptionsKey: 'openaiCompatible',
    } as any);

    expect((params as any).providerOptions).toEqual({
      openaiCompatible: {
        user: 'cache:{"namespace":"plan","components":["ctx-123"]}',
      },
    });
  });

  it('preserves explicit providerOptions while adding missing cache hint user field', () => {
    const params = buildAiSdkRequestParams({
      model: { id: 'model' },
      messages: [],
      options: {
        providerHints: {
          openAICacheHint: 'cache:{"namespace":"patch","components":["ctx-456"]}',
        },
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
          },
        },
      } as any,
      headers: {},
      abortSignal: new AbortController().signal,
      providerOptionsKey: 'openai',
    } as any);

    expect((params as any).providerOptions).toEqual({
      openai: {
        reasoningEffort: 'medium',
        user: 'cache:{"namespace":"patch","components":["ctx-456"]}',
      },
    });
  });
});
