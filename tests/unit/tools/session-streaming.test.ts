import { z } from 'zod';

import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { BudgetGuard } from '../../../src/core/tools/budget.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import { ToolRouter } from '../../../src/core/tools/router.js';
import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';
import { chatWithToolsStreaming } from '../../../src/core/tools/session.js';
import type { ToolSpec } from '../../../src/core/tools/types.js';
import { Phase, type LLMMessage, type LoopEvent } from '../../../src/core/types.js';

function createToolstack() {
  const registry = new ToolRegistry();
  const policy = new ToolPolicy();
  const budget = new BudgetGuard();
  const audit = new ToolAuditLogger();
  const sanitizer = new ToolSanitizer();
  const router = new ToolRouter(registry, policy, budget, audit, sanitizer);
  return { registry, policy, router };
}

function registerEchoTool(registry: ToolRegistry) {
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
}

describe('chatWithToolsStreaming', () => {
  it('executes streamed tool calls and feeds results back to the model', async () => {
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const calls: Array<{ messages: LLMMessage[]; options?: any }> = [];

    const llm: any = {
      chatStream(messages: LLMMessage[], options?: any) {
        calls.push({ messages, options });
        const hasToolResult = messages.some((m) => m.role === 'tool');

        if (!hasToolResult) {
          return (async function* () {
            yield {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'test.echo', arguments: JSON.stringify({ text: 'hi' }) },
                },
              ],
            };
            yield { role: 'assistant', done: true };
          })();
        }

        return (async function* () {
          yield { role: 'assistant', contentDelta: 'DONE' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const routerSpy = vi.spyOn(router, 'call');
    const calls: Array<{ messages: LLMMessage[] }> = [];

    const llm: any = {
      chatStream(messages: LLMMessage[]) {
        calls.push({ messages });
        const hasToolResult = messages.some((m) => m.role === 'tool');

        if (!hasToolResult) {
          return (async function* () {
            yield {
              role: 'assistant',
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
            yield { role: 'assistant', done: true };
          })();
        }

        const toolMsgs = messages.filter((m) => m.role === 'tool');
        expect(toolMsgs).toHaveLength(3);
        const parsed = toolMsgs.map((m) => JSON.parse(m.content));
        expect(parsed.filter((p) => p.status === 'ok')).toHaveLength(2);
        expect(parsed.filter((p) => p.error?.code === 'TOOL_CALL_BUDGET_EXCEEDED')).toHaveLength(1);

        return (async function* () {
          yield { role: 'assistant', contentDelta: 'DONE' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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
    expect(routerSpy).toHaveBeenCalledTimes(2);
    expect(calls.length).toBe(2);
  });

  it('executes tool calls even when the chunk order is text delta then tool call', async () => {
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const routerSpy = vi.spyOn(router, 'call');
    const calls: Array<{ messages: LLMMessage[] }> = [];

    const llm: any = {
      chatStream(messages: LLMMessage[]) {
        calls.push({ messages });
        const hasToolResult = messages.some((m) => m.role === 'tool');

        if (!hasToolResult) {
          return (async function* () {
            yield { role: 'assistant', contentDelta: 'partial' };
            yield {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'test.echo', arguments: JSON.stringify({ text: 'hi' }) },
                },
              ],
            };
            yield { role: 'assistant', done: true };
          })();
        }

        return (async function* () {
          yield { role: 'assistant', contentDelta: 'DONE' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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
    expect(routerSpy).toHaveBeenCalledTimes(1);
    expect(
      calls[0].messages.some((m) => m.role === 'assistant' && m.content?.includes('partial')),
    ).toBe(true);
  });

  it('supports multiple streamed tool calls in a single assistant turn', async () => {
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const calls: Array<{ messages: LLMMessage[] }> = [];

    const llm: any = {
      chatStream(messages: LLMMessage[]) {
        calls.push({ messages });
        const hasToolResult = messages.some((m) => m.role === 'tool');

        if (!hasToolResult) {
          return (async function* () {
            yield {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'test.echo', arguments: JSON.stringify({ text: 'a' }) },
                },
              ],
            };
            yield {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'test.echo', arguments: JSON.stringify({ text: 'b' }) },
                },
              ],
            };
            yield { role: 'assistant', done: true };
          })();
        }

        return (async function* () {
          yield { role: 'assistant', contentDelta: 'DONE' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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
    const toolMsgs = calls[1].messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBe(2);
    expect(toolMsgs.map((m) => m.tool_call_id).sort()).toEqual(['call_1', 'call_2']);
  });

  it('handles invalid tool argument JSON without calling the router', async () => {
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const routerSpy = vi.spyOn(router, 'call');

    const calls: Array<{ messages: LLMMessage[] }> = [];
    const llm: any = {
      chatStream(messages: LLMMessage[]) {
        calls.push({ messages });
        const hasToolResult = messages.some((m) => m.role === 'tool');

        if (!hasToolResult) {
          return (async function* () {
            yield {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'test.echo', arguments: '{' },
                },
              ],
            };
            yield { role: 'assistant', done: true };
          })();
        }

        return (async function* () {
          yield { role: 'assistant', contentDelta: 'DONE' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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
    expect(routerSpy).not.toHaveBeenCalled();

    const toolMessage = calls[1].messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('INVALID_TOOL_ARGUMENTS_JSON');
  });

  it('treats missing function.name as a malformed tool call and continues', async () => {
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const routerSpy = vi.spyOn(router, 'call');

    const calls: Array<{ messages: LLMMessage[] }> = [];
    const llm: any = {
      chatStream(messages: LLMMessage[]) {
        calls.push({ messages });
        const hasToolResult = messages.some((m) => m.role === 'tool');

        if (!hasToolResult) {
          return (async function* () {
            yield {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { arguments: JSON.stringify({ text: 'hi' }) },
                },
              ],
            };
            yield { role: 'assistant', done: true };
          })();
        }

        return (async function* () {
          yield { role: 'assistant', contentDelta: 'DONE' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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
    expect(routerSpy).not.toHaveBeenCalled();
    expect(calls[1].messages.some((m) => m.role === 'tool' && m.name === 'unknown')).toBe(true);
  });

  it('does not require a done=true chunk to terminate a stream', async () => {
    const { registry, policy, router } = createToolstack();

    const llm: any = {
      chatStream() {
        return (async function* () {
          yield { role: 'assistant', contentDelta: 'Hello' };
          yield { role: 'assistant', contentDelta: ' world' };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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

    expect(final.content).toBe('Hello world');
  });

  it('propagates stream errors and does not execute tools', async () => {
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const routerSpy = vi.spyOn(router, 'call');

    const llm: any = {
      chatStream() {
        return (async function* () {
          yield { role: 'assistant', contentDelta: 'partial' };
          throw new Error('boom');
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    await expect(
      chatWithToolsStreaming(
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
      ),
    ).rejects.toThrow('boom');

    expect(routerSpy).not.toHaveBeenCalled();
  });

  it('emits stream delta events when output policy allows', async () => {
    const { registry, policy, router } = createToolstack();
    const events: LoopEvent[] = [];

    const llm: any = {
      chatStream() {
        return (async function* () {
          yield { role: 'assistant', contentDelta: 'hello ' };
          yield { role: 'assistant', contentDelta: 'world' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const final = await chatWithToolsStreaming(
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
        emit: (event) => events.push(event),
        llmOutput: {
          policy: { kinds: ['plan'] },
          kind: 'plan',
          step: 'PLAN',
        },
      },
    );

    expect(final.content).toBe('hello world');
    const deltas = events.filter((event) => event.type === 'llm.stream.delta');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toEqual(expect.objectContaining({ content: 'hello ' }));
  });

  it('emits start/done tool logs without leaking arguments', async () => {
    const { registry, policy, router } = createToolstack();
    registerEchoTool(registry);

    const logs: string[] = [];

    const llm: any = {
      chatStream(messages: LLMMessage[]) {
        const hasToolResult = messages.some((m) => m.role === 'tool');
        if (!hasToolResult) {
          return (async function* () {
            yield {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'test.echo', arguments: JSON.stringify({ text: 'hi' }) },
                },
              ],
            };
            yield { role: 'assistant', done: true };
          })();
        }
        return (async function* () {
          yield { role: 'assistant', contentDelta: 'done' };
          yield { role: 'assistant', done: true };
        })();
      },
      async chat() {
        throw new Error('not used');
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    await chatWithToolsStreaming(
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
        emit: (event) => {
          if (event.type === 'log') {
            logs.push(event.message);
          }
        },
      },
    );

    expect(logs.some((m) => m.includes('[tool] start test.echo'))).toBe(true);
    expect(logs.some((m) => m.includes('[tool] done test.echo status=ok'))).toBe(true);
    expect(logs.some((m) => m.includes('hi'))).toBe(false); // args not leaked
  });
});
