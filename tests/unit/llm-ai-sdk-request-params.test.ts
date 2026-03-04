import { describe, expect, it } from 'bun:test';

import { buildAiSdkRequestParams } from '../../src/core/llm/ai-sdk/request-params.js';

describe('buildAiSdkRequestParams', () => {
  it('sets toolChoice to none when options.toolChoice=none', () => {
    const params = buildAiSdkRequestParams({
      model: { id: 'm' },
      messages: [{ role: 'user', content: 'hi' }],
      tools: { read: {} as any },
      options: { toolChoice: 'none' },
      headers: {},
      abortSignal: new AbortController().signal,
    });

    expect(params.toolChoice).toBe('none');
  });

  it('sets toolChoice to auto when tools exist and toolChoice is not none', () => {
    const params = buildAiSdkRequestParams({
      model: { id: 'm' },
      messages: [{ role: 'user', content: 'hi' }],
      tools: { read: {} as any },
      options: {},
      headers: {},
      abortSignal: new AbortController().signal,
    });

    expect(params.toolChoice).toBe('auto');
  });

  it('keeps toolChoice undefined when no tools are present', () => {
    const params = buildAiSdkRequestParams({
      model: { id: 'm' },
      messages: [{ role: 'user', content: 'hi' }],
      tools: undefined,
      options: {},
      headers: {},
      abortSignal: new AbortController().signal,
    });

    expect(params.toolChoice).toBeUndefined();
  });
});
