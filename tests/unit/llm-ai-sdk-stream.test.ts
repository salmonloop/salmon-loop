import { AiSdkLLM } from '../../src/core/llm/ai-sdk.js';
import { clearAuditContext, setAuditContext } from '../../src/core/observability/audit-trail.js';

mock.module('@ai-sdk/openai', () => {
  return {
    createOpenAI: () => ({
      chat: () => ({ provider: 'mock-openai-chat' }),
    }),
  };
});

mock.module('@ai-sdk/openai-compatible', () => {
  return {
    createOpenAICompatible: () => ({
      chatModel: () => ({ provider: 'mock-openai-compatible-chat' }),
    }),
  };
});

mock.module('ai', () => {
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
    generateText: mock(async () => ({ text: 'Hello world' })),
    streamText: mock(async () => ({ fullStream: makeFullStreamText() })),
    jsonSchema: mock(() => ({})),
    tool: mock(() => ({})),
  };
});

describe('AiSdkLLM.chatStream', () => {
  afterEach(() => {
    clearAuditContext();
  });

  async function getStreamTextCallArgs(): Promise<any> {
    const { streamText } = await import('ai');
    const calls = (streamText as unknown as { mock: { calls: any[][] } }).mock.calls;
    return calls[calls.length - 1][0];
  }

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

  it('attaches langfuse headers on streamText when enabled and audit context is present', async () => {
    setAuditContext({
      correlationId: 'run-test',
      phase: 'PATCH',
      sessionId: 'sess-1',
      userId: 'user-1',
    });

    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      modelId: 'gpt-mock',
      langfuseEnabled: true,
    });

    // Consume stream
    for await (const _chunk of llm.chatStream!([{ role: 'user', content: 'hi' }])) {
      // no-op
    }

    const args = await getStreamTextCallArgs();
    expect(args.headers).toMatchObject({
      langfuse_trace_id: 'run-test',
      langfuse_trace_name: 'salmonloop.run',
      langfuse_observation_name: 'PATCH',
      langfuse_session_id: 'sess-1',
      langfuse_trace_user_id: 'user-1',
    });
  });

  it('falls back to non-streaming chat when streaming is disabled', async () => {
    const { streamText } = await import('ai');
    (streamText as unknown as { mockClear: () => void }).mockClear();

    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      modelId: 'gpt-mock',
      capabilities: { streaming: false },
    });

    const chunks: Array<{ contentDelta?: string; done?: boolean }> = [];
    for await (const chunk of llm.chatStream!([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.contentDelta || '').join('')).toBe('Hello world');
    expect(chunks[chunks.length - 1]?.done).toBe(true);
    expect((streamText as unknown as { mock: { calls: any[][] } }).mock.calls).toHaveLength(0);
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
