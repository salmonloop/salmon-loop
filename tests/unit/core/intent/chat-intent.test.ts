import { describe, expect, it } from 'bun:test';

import { routeChatIntent } from '../../../../src/core/intent/chat-intent.js';
import type { ChatOptions, LLM, LLMMessage, Plan } from '../../../../src/core/types/index.js';

class JsonLlm implements LLM {
  constructor(private readonly reply: any) {}

  getCapabilities() {
    return { responseFormatJsonObject: true, toolCalling: false, streaming: false };
  }

  async chat(_messages: LLMMessage[], _options?: ChatOptions): Promise<LLMMessage> {
    return { role: 'assistant', content: JSON.stringify(this.reply) };
  }

  async createPlan(): Promise<Plan> {
    throw new Error('not implemented');
  }

  async createPatch(): Promise<string> {
    throw new Error('not implemented');
  }
}

describe('routeChatIntent', () => {
  it('routes diffs to patch (heuristic)', async () => {
    const llm = new JsonLlm({ intent: 'answer', confidence: 1, reason: 'unused' });
    const decision = await routeChatIntent('diff --git a/a.ts b/a.ts\n@@ -1 +1 @@', { llm });
    expect(decision.intent).toBe('patch');
    expect(decision.classifier).toBe('heuristic');
  });

  it('routes stack traces to debug (heuristic)', async () => {
    const llm = new JsonLlm({ intent: 'answer', confidence: 1, reason: 'unused' });
    const decision = await routeChatIntent('TypeError: x is not a function\n    at foo:1:2', {
      llm,
    });
    expect(decision.intent).toBe('debug');
    expect(decision.classifier).toBe('heuristic');
  });

  it('uses LLM classification for non-ascii inputs', async () => {
    const llm = new JsonLlm({ intent: 'answer', confidence: 0.9, reason: 'question' });
    const decision = await routeChatIntent('解释一下这个项目在做什么', { llm });
    expect(decision.intent).toBe('answer');
    expect(decision.classifier).toBe('llm');
  });

  it('downgrades low-confidence mutating intents to answer', async () => {
    const llm = new JsonLlm({ intent: 'patch', confidence: 0.2, reason: 'uncertain' });
    const decision = await routeChatIntent('请修复这个问题', { llm });
    expect(decision.intent).toBe('answer');
    expect(decision.classifier).toBe('llm');
  });
});
