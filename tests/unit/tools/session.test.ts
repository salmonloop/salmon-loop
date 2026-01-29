import { z } from 'zod';

import { ToolAuditLogger } from '../../../src/core/tools/audit';
import { BudgetGuard } from '../../../src/core/tools/budget';
import { ToolPolicy } from '../../../src/core/tools/policy';
import { ToolRegistry } from '../../../src/core/tools/registry';
import { ToolRouter } from '../../../src/core/tools/router';
import { ToolSanitizer } from '../../../src/core/tools/sanitize';
import { chatWithTools } from '../../../src/core/tools/session';
import type { ToolSpec } from '../../../src/core/tools/types';
import { Phase, type LLM, type LLMMessage } from '../../../src/core/types';

describe('chatWithTools', () => {
  it('executes OpenAI-style tool calls and feeds results back to the model', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const echoSpec: ToolSpec<{ text: string }, { text: string }> = {
      name: 'test.echo',
      source: 'builtin',
      description: 'Echo tool for testing',
      riskLevel: 'low',
      sideEffects: ['none'],
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      executor: async (input) => ({ text: input.text.toUpperCase() }),
    };
    registry.register(echoSpec);

    const calls: Array<{ messages: LLMMessage[]; options?: any }> = [];
    const llm: LLM = {
      async chat(messages, options) {
        calls.push({ messages, options });
        const toolMsg = messages.find((m) => m.role === 'tool');
        if (!toolMsg) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'test.echo', arguments: JSON.stringify({ text: 'hi' }) },
              },
            ],
          };
        }
        return { role: 'assistant', content: 'DONE' };
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithTools(
      [{ role: 'user', content: 'prompt' }],
      {},
      {
        phase: Phase.PLAN,
        llm,
        runtime: {
          repoRoot: '/tmp',
          attemptId: 1,
          dryRun: true,
          model: 'test-model',
          worktreeRoot: '/tmp',
        },
        toolstack: { registry, policy, router },
      },
    );

    expect(final.content).toBe('DONE');
    expect(calls.length).toBe(2);
    expect(calls[0].options?.tools?.length).toBeGreaterThanOrEqual(1);
    expect(calls[1].messages.some((m) => m.role === 'tool' && m.name === 'test.echo')).toBe(true);
  });
});
