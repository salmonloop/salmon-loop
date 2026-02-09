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
  return {
    generateText: vi.fn(async () => ({ text: 'ok' })),
    streamText: vi.fn(async () => ({ fullStream: (async function* () {})() })),
    jsonSchema: vi.fn(() => ({})),
    tool: vi.fn(() => ({})),
  };
});

describe('AiSdkLLM message mapping', () => {
  async function getGenerateTextMessages(): Promise<any[]> {
    const { generateText } = await import('ai');
    const calls = (generateText as unknown as { mock: { calls: any[][] } }).mock.calls;
    return calls[calls.length - 1][0].messages;
  }

  beforeEach(async () => {
    const { generateText } = await import('ai');
    (generateText as unknown as { mockClear: () => void }).mockClear();
  });

  it('maps assistant tool calls to AI SDK `input` parts', async () => {
    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      modelId: 'gpt-mock',
    });

    await llm.chat([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'fs.read', arguments: JSON.stringify({ file: 'README.md' }) },
          },
        ],
      },
    ]);

    const messages = await getGenerateTextMessages();
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'fs.read',
          input: { file: 'README.md' },
        },
      ],
    });
  });

  it('maps tool role payloads to AI SDK `tool-result` output format', async () => {
    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      modelId: 'gpt-mock',
    });

    await llm.chat([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'fs.read', arguments: JSON.stringify({ file: 'README.md' }) },
          },
        ],
      },
      {
        role: 'tool',
        name: 'fs.read',
        tool_call_id: 'call_1',
        content: JSON.stringify({
          status: 'ok',
          output: { content: '# README', size: 8 },
        }),
      },
    ]);

    const messages = await getGenerateTextMessages();
    expect(messages[2]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'fs.read',
          output: {
            type: 'json',
            value: {
              status: 'ok',
              output: { content: '# README', size: 8 },
            },
          },
        },
      ],
    });
  });

  it('maps tool approval payloads to AI SDK tool approval response format', async () => {
    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      modelId: 'gpt-mock',
    });

    await llm.chat([
      { role: 'user', content: 'hi' },
      {
        role: 'tool',
        name: 'proposal.apply',
        tool_call_id: 'approval_1',
        content: JSON.stringify({
          approvalId: 'approval_1',
          approved: true,
          reason: 'approved by user',
        }),
      },
    ]);

    const messages = await getGenerateTextMessages();
    expect(messages[1]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: 'approval_1',
          approved: true,
          reason: 'approved by user',
        },
      ],
    });
  });
});
