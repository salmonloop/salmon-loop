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

  it('derives cache hint from policy when direct hint is not provided', () => {
    const params = buildAiSdkRequestParams({
      model: { id: 'model' },
      messages: [],
      options: {
        providerHints: {
          openAICachePolicy: {
            mode: 'strict_full_prompt',
            eligibility: 'eligible',
            namespace: 'research',
            contextHash: 'ctx-789',
            cacheSafeFingerprint: 'a'.repeat(64),
            lateInjectionFingerprint: 'b'.repeat(64),
          },
        },
      } as any,
      headers: {},
      abortSignal: new AbortController().signal,
      providerOptionsKey: 'openai',
    } as any);

    expect((params as any).providerOptions).toEqual({
      openai: {
        user: `cache:{"namespace":"research","components":["ctx-789","stable:${'a'.repeat(64)}","late:${'b'.repeat(64)}"]}`,
      },
    });
  });

  it('skips providerOptions cache user injection when policy is not eligible', () => {
    const params = buildAiSdkRequestParams({
      model: { id: 'model' },
      messages: [],
      options: {
        providerHints: {
          openAICachePolicy: {
            mode: 'cache_safe_only',
            eligibility: 'below_min_tokens',
            namespace: 'plan',
            contextHash: 'ctx-000',
            cacheSafeFingerprint: 'c'.repeat(64),
          },
        },
      } as any,
      headers: {},
      abortSignal: new AbortController().signal,
      providerOptionsKey: 'openai',
    } as any);

    expect((params as any).providerOptions).toBeUndefined();
  });
});
