import { describe, expect, it } from 'bun:test';

import { buildAiSdkRequestParams } from '../../../../../src/core/llm/ai-sdk/request-params.js';
import type { ChatOptions } from '../../../../../src/core/types/llm.js';

type BuildAiSdkRequestParamsInput = Parameters<typeof buildAiSdkRequestParams>[0];
type BuildAiSdkRequestParamsOutput = ReturnType<typeof buildAiSdkRequestParams>;

function buildParams(
  overrides: Partial<BuildAiSdkRequestParamsInput> & { options?: ChatOptions } = {},
): BuildAiSdkRequestParamsOutput {
  return buildAiSdkRequestParams({
    model: { id: 'model' },
    messages: [],
    options: overrides.options ?? {},
    headers: {},
    abortSignal: new AbortController().signal,
    providerOptionsKey: overrides.providerOptionsKey ?? 'openai',
    tools: overrides.tools,
  });
}

describe('buildAiSdkRequestParams', () => {
  it('injects OpenAI-compatible cache hints into providerOptions', () => {
    const params = buildParams({
      providerOptionsKey: 'openaiCompatible',
      options: {
        providerHints: {
          openAICacheHint: 'cache:{"namespace":"plan","components":["ctx-123"]}',
        },
      },
    });

    expect(params.providerOptions).toEqual({
      openaiCompatible: {
        user: 'cache:{"namespace":"plan","components":["ctx-123"]}',
      },
    });
  });

  it('preserves explicit providerOptions while adding missing cache hint user field', () => {
    const params = buildParams({
      options: {
        providerHints: {
          openAICacheHint: 'cache:{"namespace":"patch","components":["ctx-456"]}',
        },
        providerOptions: {
          openai: {
            reasoningEffort: 'medium',
          },
        },
      },
    });

    expect(params.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'medium',
        user: 'cache:{"namespace":"patch","components":["ctx-456"]}',
      },
    });
  });

  it('derives cache hint from policy when direct hint is not provided', () => {
    const params = buildParams({
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
      },
    });

    expect(params.providerOptions).toEqual({
      openai: {
        user: `cache:{"namespace":"research","components":["ctx-789","stable:${'a'.repeat(64)}","late:${'b'.repeat(64)}"]}`,
      },
    });
  });

  it('skips providerOptions cache user injection when policy is not eligible', () => {
    const params = buildParams({
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
      },
    });

    expect(params.providerOptions).toBeUndefined();
  });

  it('maps json_object response format for capable models', () => {
    const params = buildParams({
      options: {
        responseFormat: 'json_object',
        responseFormatJsonObjectSupported: true,
      },
    });

    expect(params.responseFormat).toEqual({ type: 'json' });
  });

  it('omits json_object response format when capability is disabled', () => {
    const params = buildParams({
      options: {
        responseFormat: 'json_object',
        responseFormatJsonObjectSupported: false,
      },
    });

    expect(params.responseFormat).toBeUndefined();
  });

  it('maps text response format explicitly', () => {
    const params = buildParams({
      options: {
        responseFormat: 'text',
      },
    });

    expect(params.responseFormat).toEqual({ type: 'text' });
  });
});
