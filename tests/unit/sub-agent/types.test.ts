import { describe, expect, it } from 'bun:test';

import { SubAgentRequestSchema } from '../../../src/core/sub-agent/types.js';

describe('sub-agent types schema', () => {
  it('accepts conversationContext entries with tool metadata', () => {
    const parsed = SubAgentRequestSchema.parse({
      agent_ref: 'surgeon',
      task: 'review patch context',
      session_target: 'shared',
      contextSnapshot: {
        conversationContext: [
          {
            role: 'assistant',
            content: 'calling fs.read',
            reasoning_content: 'need file content first',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'fs.read', arguments: '{"file":"src/index.ts"}' },
              },
            ],
          },
          {
            role: 'tool',
            content: '{"content":"ok"}',
            tool_call_id: 'call-1',
          },
        ],
      },
    });

    expect(parsed.contextSnapshot?.conversationContext?.[0]?.role).toBe('assistant');
    expect(parsed.contextSnapshot?.conversationContext?.[0]?.reasoning_content).toBe(
      'need file content first',
    );
    expect(parsed.contextSnapshot?.conversationContext?.[1]?.role).toBe('tool');
  });
});
