import { describe, expect, it } from 'bun:test';

import { buildAiSdkRequestParams } from '../../src/core/llm/ai-sdk/request-params.js';
import type { LLMMessage } from '../../src/core/types/llm.js';

type BuildAiSdkRequestParamsInput = Parameters<typeof buildAiSdkRequestParams>[0];

function buildParams(overrides: Partial<BuildAiSdkRequestParamsInput> = {}) {
  return buildAiSdkRequestParams({
    model: { id: 'm' },
    messages: [{ role: 'user', content: 'hi' }] satisfies LLMMessage[],
    tools: overrides.tools,
    options: overrides.options ?? {},
    headers: {},
    abortSignal: new AbortController().signal,
    providerOptionsKey: overrides.providerOptionsKey ?? 'openai',
  });
}

const sampleTools = ({ read: {} } as unknown) as NonNullable<BuildAiSdkRequestParamsInput['tools']>;

describe('buildAiSdkRequestParams', () => {
  it('sets toolChoice to none when options.toolChoice=none', () => {
    const params = buildParams({
      tools: sampleTools,
      options: { toolChoice: 'none' },
    });

    expect(params.toolChoice).toBe('none');
  });

  it('sets toolChoice to auto when tools exist and toolChoice is not none', () => {
    const params = buildParams({
      tools: sampleTools,
    });

    expect(params.toolChoice).toBe('auto');
  });

  it('keeps toolChoice undefined when no tools are present', () => {
    const params = buildParams();

    expect(params.toolChoice).toBeUndefined();
  });
});
