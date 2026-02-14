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
  async function* makeFullStreamText() {
    yield { type: 'text-delta', id: 't1', text: 'Hello' };
    yield { type: 'text-delta', id: 't1', text: ' ' };
    yield { type: 'text-delta', id: 't1', text: 'world' };
    yield {
      type: 'finish',
      finishReason: 'stop',
      rawFinishReason: 'stop',
      usage: { promptTokens: 3, completionTokens: 7 },
    };
  }

  return {
    generateText: vi.fn(async () => ({ text: 'Hello world' })),
    streamText: vi.fn(async () => ({ fullStream: makeFullStreamText() })),
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
    expect((chunks[chunks.length - 1] as any)?.usage).toEqual({
      promptTokens: 3,
      completionTokens: 7,
    });
  });

  it('emits tool_calls chunks when tool-call events are streamed', async () => {
    const { streamText } = await import('ai');
    const streamTextMock = streamText as unknown as { mockImplementationOnce: any };

    async function* makeToolStream() {
      yield {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'test.echo',
        input: { text: 'hi' },
      };
      yield {
        type: 'finish',
        finishReason: 'stop',
        rawFinishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 2 },
      };
    }

    streamTextMock.mockImplementationOnce(async () => ({ fullStream: makeToolStream() }));

    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      modelId: 'gpt-mock',
    });

    const chunks: Array<{ tool_calls?: any[]; done?: boolean }> = [];
    for await (const chunk of llm.chatStream!([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find((c) => Array.isArray(c.tool_calls) && c.tool_calls.length > 0);
    expect(toolChunk?.tool_calls?.[0]?.function?.name).toBe('test.echo');
    expect(toolChunk?.tool_calls?.[0]?.function?.arguments).toBe(JSON.stringify({ text: 'hi' }));
  });
});
