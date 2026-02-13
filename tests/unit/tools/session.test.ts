import { z } from 'zod';

import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { BudgetGuard } from '../../../src/core/tools/budget.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import { ToolRouter } from '../../../src/core/tools/router.js';
import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';
import { chatWithTools } from '../../../src/core/tools/session.js';
import type { ToolSpec } from '../../../src/core/tools/types.js';
import { Phase, type LLM, type LLMMessage } from '../../../src/core/types/index.js';

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
      intent: 'INFRA',
      description: 'Echo tool for testing',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
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

  it('denies excess tool calls when the session budget is exceeded', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    let executed = 0;
    const echoSpec: ToolSpec<{ text: string }, { text: string }> = {
      name: 'test.echo',
      source: 'builtin',
      intent: 'INFRA',
      description: 'Echo tool for testing',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      executor: async (input) => {
        executed++;
        return { text: input.text.toUpperCase() };
      },
    };
    registry.register(echoSpec);

    const llm: LLM = {
      async chat(messages) {
        const toolMsgs = messages.filter((m) => m.role === 'tool');
        if (toolMsgs.length === 0) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'test.echo', arguments: JSON.stringify({ text: 'a' }) },
              },
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'test.echo', arguments: JSON.stringify({ text: 'b' }) },
              },
              {
                id: 'call_3',
                type: 'function',
                function: { name: 'test.echo', arguments: JSON.stringify({ text: 'c' }) },
              },
            ],
          };
        }

        expect(toolMsgs).toHaveLength(3);
        const parsed = toolMsgs.map((m) => JSON.parse(m.content));
        expect(parsed.filter((p) => p.status === 'ok')).toHaveLength(2);
        expect(parsed.filter((p) => p.error?.code === 'TOOL_CALL_BUDGET_EXCEEDED')).toHaveLength(1);

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
        maxToolCallsPerRound: 2,
        maxToolCallsTotal: 2,
      },
    );

    expect(final.content).toBe('DONE');
    expect(executed).toBe(2);
  });
});
