import { describe, expect, it, vi } from 'vitest';

import { AiSdkLLM } from '../../src/core/llm/ai-sdk.js';

vi.mock('@ai-sdk/openai', () => {
  return {
    createOpenAI: () => ({
      chat: () => ({ provider: 'mock-openai-chat' }),
    }),
  };
});

vi.mock('@ai-sdk/openai-compatible', () => {
  return {
    createOpenAICompatible: () => ({
      chatModel: () => ({ provider: 'mock-openai-compatible-chat' }),
    }),
  };
});

vi.mock('ai', () => {
  async function* makeStream() {
    yield 'Hello';
    yield ' ';
    yield 'world';
  }

  return {
    generateText: vi.fn(async () => ({ text: 'Hello world' })),
    streamText: vi.fn(async () => ({ textStream: makeStream() })),
    jsonSchema: vi.fn(() => ({})),
    tool: vi.fn(() => ({})),
  };
});

describe('AiSdkLLM.chatStream', () => {
  it('yields text deltas and ends with done=true', async () => {
    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      modelId: 'gpt-mock',
    });

    const chunks: Array<{ role: string; contentDelta?: string; done?: boolean }> = [];
    for await (const chunk of llm.chatStream!([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }

    const text = chunks.map((c) => c.contentDelta || '').join('');
    expect(text).toBe('Hello world');
    expect(chunks[chunks.length - 1]?.done).toBe(true);
  });
});
