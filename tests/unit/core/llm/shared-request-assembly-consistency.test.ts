import { describe, expect, it } from 'bun:test';

import { buildSharedRequestEnvelope as buildGrizzcoSharedRequestEnvelope } from '../../../../src/core/grizzco/steps/request-assembly.js';
import { composeChatMessages } from '../../../../src/core/llm/message-composition.js';
import { buildSharedRequestEnvelope } from '../../../../src/core/llm/shared-request-assembly.js';

describe('shared request assembly cross-entry consistency', () => {
  it('keeps chat composition aligned with shared request assembly output', () => {
    const conversationContext = [
      { role: 'system' as const, content: '[Previous conversation summary]\nSummary body' },
      { role: 'user' as const, content: 'previous question' },
      { role: 'assistant' as const, content: 'previous answer' },
    ];

    const expected = buildSharedRequestEnvelope({
      defaultNamespace: 'chat',
      systemPrompt: 'root system',
      userPrompt: 'current user',
      conversationContext,
    }).baseMessages;

    const actual = composeChatMessages({
      system: 'root system',
      user: 'current user',
      conversationContext,
    });

    expect(actual).toEqual(expected);
  });

  it('keeps grizzco shared helper output aligned with core shared request assembly', () => {
    const args = {
      defaultNamespace: 'answer',
      contextHash: 'ctx-123',
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      conversationContext: [{ role: 'assistant' as const, content: 'previous answer' }],
      attachments: [
        {
          key: 'context-prompt',
          kind: 'context' as const,
          label: 'Context prompt',
          content: 'context text',
          cacheSafe: true,
        },
      ],
    };

    expect(buildGrizzcoSharedRequestEnvelope(args)).toEqual(buildSharedRequestEnvelope(args));
  });

  it('preserves attachment ordering for cache-safe context then late-injection plan', () => {
    const built = buildSharedRequestEnvelope({
      defaultNamespace: 'patch',
      contextHash: 'ctx-order',
      systemPrompt: '',
      userPrompt: 'patch prompt',
      attachments: [
        {
          key: 'context-prompt',
          kind: 'context',
          label: 'Context prompt',
          content: 'context',
          cacheSafe: true,
        },
        {
          key: 'plan-json',
          kind: 'plan',
          label: 'Plan JSON',
          content: '{"goal":"g"}',
        },
      ],
    });

    expect(built.envelope.attachments.map((item) => item.key)).toEqual([
      'context-prompt',
      'plan-json',
    ]);
    expect(built.envelope.attachments[0]?.cacheSafe).toBe(true);
    expect(built.envelope.attachments[1]?.cacheSafe).toBeUndefined();
  });
});
