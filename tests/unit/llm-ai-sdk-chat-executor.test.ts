import { describe, expect, it } from 'bun:test';

mock.module('ai', () => {
  async function* makeStream() {
    yield { type: 'text-delta', text: 'he' };
    yield { type: 'text-delta', text: 'llo' };
    yield { type: 'finish', finishReason: 'stop' };
  }

  return {
    generateText: mock(async () => ({
      text: 'ok',
      usage: { promptTokens: 1, completionTokens: 2 },
    })),
    streamText: mock(async () => ({ fullStream: makeStream() })),
  };
});

import {
  executeAiSdkChatRequest,
  executeAiSdkChatStreamRequest,
} from '../../src/core/llm/ai-sdk/chat-executor.js';
import { clearAuditTrail, getAuditTrail } from '../../src/core/observability/audit-trail.js';

describe('ai-sdk chat executor', () => {
  it('executes unary request and maps result', async () => {
    clearAuditTrail();

    const message = await executeAiSdkChatRequest({
      model: { provider: 'mock' },
      modelId: 'gpt-test',
      providerOptionsKey: 'openai',
      timeoutMs: undefined,
      langfuseEnabled: false,
      requestId: 'req-1',
      messages: [{ role: 'user', content: 'hi' }],
      tools: undefined,
      options: {},
    });

    expect(message).toMatchObject({
      role: 'assistant',
      content: 'ok',
    });

    const trail = getAuditTrail();
    const usageEvent = trail.find((e) => e.action === 'llm.usage');
    expect(usageEvent?.details).toMatchObject({ promptTokens: 1, completionTokens: 2 });
  });

  it('executes streaming request and yields mapped chunks', async () => {
    const chunks: any[] = [];
    for await (const chunk of executeAiSdkChatStreamRequest({
      model: { provider: 'mock' },
      modelId: 'gpt-test',
      providerOptionsKey: 'openai',
      timeoutMs: undefined,
      langfuseEnabled: false,
      requestId: 'req-2',
      messages: [{ role: 'user', content: 'hi' }],
      tools: undefined,
      options: {},
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({ contentDelta: 'he' });
    expect(chunks[1]).toMatchObject({ contentDelta: 'llo' });
    expect(chunks[chunks.length - 1]).toMatchObject({ done: true, finishReason: 'stop' });
  });
});
