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

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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
    expect(calls[0].options?.phase).toBe(Phase.PLAN);
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

  it('keeps agent delegation available when regular tool calls exhaust their budget', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const executed: string[] = [];
    const readSpec: ToolSpec<{ text: string }, { text: string }> = {
      name: 'test.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read tool for testing',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      executor: async (input) => {
        executed.push(`read:${input.text}`);
        return { text: input.text };
      },
    };
    const agentSpec: ToolSpec<{ task: string }, { ok: boolean }> = {
      name: 'test.agent',
      source: 'builtin',
      intent: 'AGENT',
      description: 'Delegation tool for testing',
      riskLevel: 'medium',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ task: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      executor: async (input) => {
        executed.push(`agent:${input.task}`);
        return { ok: true };
      },
    };
    registry.register(readSpec);
    registry.register(agentSpec);

    const llm: LLM = {
      async chat(messages) {
        const toolMsgs = messages.filter((m) => m.role === 'tool');
        if (toolMsgs.length === 0) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_read_1',
                type: 'function',
                function: { name: 'test.read', arguments: JSON.stringify({ text: 'a' }) },
              },
              {
                id: 'call_read_2',
                type: 'function',
                function: { name: 'test.read', arguments: JSON.stringify({ text: 'b' }) },
              },
              {
                id: 'call_agent',
                type: 'function',
                function: { name: 'test.agent', arguments: JSON.stringify({ task: 'inspect' }) },
              },
            ],
          };
        }

        const parsed = toolMsgs.map((m) => JSON.parse(m.content));
        const byTool = new Map(parsed.map((p) => [p.toolName, p]));
        expect(parsed.filter((p) => p.status === 'ok')).toHaveLength(2);
        expect(byTool.get('test.agent')?.status).toBe('ok');
        expect(
          parsed.some(
            (p) => p.toolName === 'test.read' && p.error?.code === 'TOOL_CALL_BUDGET_EXCEEDED',
          ),
        ).toBe(true);

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
        maxToolCallsPerRound: 1,
        maxToolCallsTotal: 1,
      },
    );

    expect(final.content).toBe('DONE');
    expect(executed).toEqual(['read:a', 'agent:inspect']);
  });

  it('enforces explicit agent delegation budgets independently from regular tools', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    let executed = 0;
    const agentSpec: ToolSpec<{ task: string }, { ok: boolean }> = {
      name: 'test.agent',
      source: 'builtin',
      intent: 'AGENT',
      description: 'Delegation tool for testing',
      riskLevel: 'medium',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ task: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      executor: async () => {
        executed++;
        return { ok: true };
      },
    };
    registry.register(agentSpec);

    const llm: LLM = {
      async chat(messages) {
        const toolMsgs = messages.filter((m) => m.role === 'tool');
        if (toolMsgs.length === 0) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_agent_1',
                type: 'function',
                function: { name: 'test.agent', arguments: JSON.stringify({ task: 'inspect' }) },
              },
              {
                id: 'call_agent_2',
                type: 'function',
                function: { name: 'test.agent', arguments: JSON.stringify({ task: 'review' }) },
              },
            ],
          };
        }

        const parsed = toolMsgs.map((m) => JSON.parse(m.content));
        expect(parsed.filter((p) => p.status === 'ok')).toHaveLength(1);
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
        maxAgentToolCallsPerRound: 1,
        maxAgentToolCallsTotal: 1,
      },
    );

    expect(final.content).toBe('DONE');
    expect(executed).toBe(1);
  });

  it('lets autopilot complete a delegated multi-file edit and verify task using default budgets', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const executed: string[] = [];
    const register = <I extends Record<string, unknown>, O extends Record<string, unknown>>(
      spec: ToolSpec<I, O>,
    ) => {
      registry.register(spec);
    };

    register({
      name: 'fs.list_directory',
      source: 'builtin',
      intent: 'LIST',
      description: 'List project files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ entries: z.array(z.string()) }),
      executor: async (input) => {
        executed.push(`list:${input.path}`);
        return { entries: ['src/catalog.js', 'src/cart.js', 'test/cart.test.js'] };
      },
    });
    register({
      name: 'fs.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read a file',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string(), size: z.number() }),
      executor: async (input) => {
        executed.push(`read:${input.file}`);
        return { content: `content:${input.file}`, size: input.file.length };
      },
    });
    register({
      name: 'agent_dispatch',
      source: 'builtin',
      intent: 'AGENT',
      description: 'Dispatch sub-agent',
      riskLevel: 'medium',
      sideEffects: ['none', 'fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ agent_ref: z.string(), task: z.string() }),
      outputSchema: z.object({ success: z.boolean(), summary: z.string() }),
      executor: async (input) => {
        executed.push(`agent:${input.agent_ref}`);
        return { success: true, summary: input.task };
      },
    });
    register({
      name: 'fs.write_file',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Write a file',
      riskLevel: 'high',
      sideEffects: ['fs_write'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ file: z.string(), content: z.string() }),
      outputSchema: z.object({ ok: z.boolean(), path: z.string() }),
      executor: async (input) => {
        executed.push(`write:${input.file}`);
        return { ok: true, path: input.file };
      },
    });
    register({
      name: 'shell.exec',
      source: 'builtin',
      intent: 'INFRA',
      description: 'Run verification',
      riskLevel: 'medium',
      sideEffects: ['process'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ command: z.string() }),
      outputSchema: z.object({ exitCode: z.number(), stdout: z.string(), stderr: z.string() }),
      executor: async (input) => {
        executed.push(`verify:${input.command}`);
        return { exitCode: 0, stdout: 'pass', stderr: '' };
      },
    });

    let round = 0;
    const llm: LLM = {
      async chat(messages) {
        const toolMessages = messages.filter((m) => m.role === 'tool');
        for (const message of toolMessages) {
          const parsed = JSON.parse(message.content);
          expect(parsed.error?.code).not.toBe('TOOL_CALL_BUDGET_EXCEEDED');
        }

        if (round === 0) {
          round++;
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_list',
                type: 'function',
                function: { name: 'fs.list_directory', arguments: JSON.stringify({ path: '.' }) },
              },
              {
                id: 'call_read_catalog',
                type: 'function',
                function: {
                  name: 'fs.read',
                  arguments: JSON.stringify({ file: 'src/catalog.js' }),
                },
              },
              {
                id: 'call_read_cart',
                type: 'function',
                function: { name: 'fs.read', arguments: JSON.stringify({ file: 'src/cart.js' }) },
              },
              {
                id: 'call_read_test',
                type: 'function',
                function: {
                  name: 'fs.read',
                  arguments: JSON.stringify({ file: 'test/cart.test.js' }),
                },
              },
              {
                id: 'call_agent_explorer',
                type: 'function',
                function: {
                  name: 'agent_dispatch',
                  arguments: JSON.stringify({ agent_ref: 'explorer', task: 'Inspect failures' }),
                },
              },
              {
                id: 'call_agent_reviewer',
                type: 'function',
                function: {
                  name: 'agent_dispatch',
                  arguments: JSON.stringify({ agent_ref: 'reviewer', task: 'Review fix plan' }),
                },
              },
            ],
          };
        }

        if (round === 1) {
          round++;
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_write_catalog',
                type: 'function',
                function: {
                  name: 'fs.write_file',
                  arguments: JSON.stringify({
                    file: 'src/catalog.js',
                    content: 'export const catalog = [];\n',
                  }),
                },
              },
              {
                id: 'call_write_cart',
                type: 'function',
                function: {
                  name: 'fs.write_file',
                  arguments: JSON.stringify({
                    file: 'src/cart.js',
                    content: 'export const cart = [];\n',
                  }),
                },
              },
            ],
          };
        }

        if (round === 2) {
          round++;
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_verify',
                type: 'function',
                function: {
                  name: 'shell.exec',
                  arguments: JSON.stringify({ command: 'node --test test/*.test.js' }),
                },
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
      [{ role: 'user', content: 'fix the cart workflow and verify it' }],
      {},
      {
        phase: Phase.AUTOPILOT,
        llm,
        runtime: {
          repoRoot: '/tmp',
          attemptId: 1,
          dryRun: true,
          flowMode: 'autopilot',
          model: 'test-model',
          worktreeRoot: '/tmp',
        },
        toolstack: { registry, policy, router },
      },
    );

    expect(final.content).toBe('DONE');
    expect(executed).toEqual([
      'list:.',
      'read:src/catalog.js',
      'read:src/cart.js',
      'read:test/cart.test.js',
      'agent:explorer',
      'agent:reviewer',
      'write:src/catalog.js',
      'write:src/cart.js',
      'verify:node --test test/*.test.js',
    ]);
  });

  it('records args preview in toolCallingAudit only for INVALID_INPUT tool results', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const executor = mock(async () => ({ ok: true }));
    const spec: ToolSpec<{ required: string }, { ok: boolean }> = {
      name: 'test.requires',
      source: 'builtin',
      intent: 'INFRA',
      description: 'Requires input',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ required: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      executor,
    };
    registry.register(spec);

    const toolCallingAudit: any[] = [];
    const llm: LLM = {
      async chat(messages) {
        const toolMsg = messages.find((m) => m.role === 'tool');
        if (!toolMsg) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'test.requires', arguments: '{}' },
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
        toolCallingAudit: { event: (e) => toolCallingAudit.push(e) },
      },
    );

    expect(final.content).toBe('DONE');
    expect(executor).not.toHaveBeenCalled();

    const invalid = toolCallingAudit.find((e) => e.toolResultErrorCode === 'INVALID_INPUT');
    expect(invalid).toBeTruthy();
    expect(typeof invalid.rawArgsPreview).toBe('string');
    expect(typeof invalid.parsedArgsPreview).toBe('string');
  });

  it('formats recoverable tool input failures as retryable correction hints', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const spec: ToolSpec<{ file: string; content: string }, { ok: boolean }> = {
      name: 'fs.write_file',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Write file',
      riskLevel: 'low',
      sideEffects: ['fs_write'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.PATCH],
      inputSchema: z.object({
        file: z.string(),
        content: z.string(),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      executor: async () => ({ ok: true }),
    };
    registry.register(spec);

    let chatCalls = 0;
    let sawRetryRound = false;
    const llm: LLM = {
      async chat(messages) {
        chatCalls++;
        const toolMsg = messages.find((message) => message.role === 'tool');
        if (!toolMsg) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_retry',
                type: 'function',
                function: {
                  name: 'fs.write_file',
                  arguments: JSON.stringify({ path: 'note.txt', contents: 'hello' }),
                },
              },
            ],
          };
        }

        sawRetryRound = true;
        const parsed = JSON.parse(toolMsg.content);
        expect(parsed.status).toBe('error');
        expect(parsed.error?.code).toBe('INVALID_INPUT');
        expect(parsed.error?.retryable).toBe(true);
        expect(parsed.meta?.retryHint).toMatchObject({
          retryable: true,
        });
        expect(typeof parsed.meta?.retryHint?.kind).toBe('string');
        expect(typeof parsed.meta?.retryHint?.tool).toBe('string');

        return { role: 'assistant', content: 'DONE' };
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    await chatWithTools(
      [{ role: 'user', content: 'write the file' }],
      {},
      {
        phase: Phase.PATCH,
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

    expect(chatCalls).toBeGreaterThanOrEqual(2);
    expect(sawRetryRound).toBe(true);
  });

  it('records toolResultOutputOk for successful tool results', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const executor = mock(async () => ({ ok: true }));
    const spec: ToolSpec<{ input: string }, { ok: boolean }> = {
      name: 'test.success',
      source: 'builtin',
      intent: 'INFRA',
      description: 'Success tool',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ input: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      executor,
    };
    registry.register(spec);

    const toolCallingAudit: any[] = [];
    const llm: LLM = {
      async chat(messages) {
        const toolMsg = messages.find((m) => m.role === 'tool');
        if (!toolMsg) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_success',
                type: 'function',
                function: { name: 'test.success', arguments: JSON.stringify({ input: 'ok' }) },
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
        toolCallingAudit: { event: (e) => toolCallingAudit.push(e) },
      },
    );

    expect(final.content).toBe('DONE');
    expect(executor).toHaveBeenCalledTimes(1);

    const okEntry = toolCallingAudit.find((e) => e.toolResultOutputOk === true);
    expect(okEntry).toBeTruthy();
    expect(okEntry.toolResultStatus).toBe('ok');
  });

  it('records recent read artifacts for successful fs.read tool results', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const spec: ToolSpec<{ file: string }, { content: string; size: number }> = {
      name: 'fs.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read file',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string(), size: z.number() }),
      executor: async () => ({ content: 'const x = 1;\n', size: 13 }),
    };
    registry.register(spec);

    const toolCallingAudit: any[] = [];
    const llm: LLM = {
      async chat(messages) {
        const toolMsg = messages.find((m) => m.role === 'tool');
        if (!toolMsg) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_read',
                type: 'function',
                function: {
                  name: 'fs.read',
                  arguments: JSON.stringify({ file: 'src/index.ts' }),
                },
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
        toolCallingAudit: { event: (e) => toolCallingAudit.push(e) },
      },
    );

    expect(final.content).toBe('DONE');

    const readEntry = toolCallingAudit.find((e) => e.toolResultReadArtifactPath === 'src/index.ts');
    expect(readEntry).toBeTruthy();
    expect(readEntry.toolResultReadArtifactPath).toBe('src/index.ts');
    expect(readEntry.toolResultReadArtifact?.handle).toContain('s8p://artifact/');
  });

  it('runs parallel-safe reads together while serializing a write behind them', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const executionOrder: string[] = [];
    const readAStarted = deferred<void>();
    const readBStarted = deferred<void>();
    const releaseReads = deferred<void>();
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();

    registry.register({
      name: 'fs.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read file',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string(), size: z.number() }),
      computeResources: (_input, ctx) => [
        { kind: 'pathPrefix', repoId: ctx.repoRoot, prefix: 'src/' },
      ],
      executor: async (input) => {
        executionOrder.push(`fs.read:${input.file}:start`);
        if (input.file === 'src/a.ts') readAStarted.resolve();
        if (input.file === 'src/b.ts') readBStarted.resolve();
        await releaseReads.promise;
        executionOrder.push(`fs.read:${input.file}:end`);
        return { content: `read:${input.file}`, size: input.file.length };
      },
    });

    registry.register({
      name: 'fs.write_file',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Write file',
      riskLevel: 'high',
      sideEffects: ['fs_write'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ file: z.string(), content: z.string() }),
      outputSchema: z.object({ ok: z.boolean(), path: z.string(), bytesWritten: z.number() }),
      computeResources: (_input, ctx) => [
        { kind: 'pathPrefix', repoId: ctx.repoRoot, prefix: 'src/' },
      ],
      executor: async (input) => {
        executionOrder.push(`fs.write:${input.file}:start`);
        writeStarted.resolve();
        await releaseWrite.promise;
        executionOrder.push(`fs.write:${input.file}:end`);
        return { ok: true, path: input.file, bytesWritten: input.content.length };
      },
    });

    let round = 0;
    const llm: LLM = {
      async chat(messages) {
        round++;
        const toolMessages = messages.filter((message) => message.role === 'tool');
        if (toolMessages.length === 0) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call-read-a',
                type: 'function',
                function: { name: 'fs.read', arguments: JSON.stringify({ file: 'src/a.ts' }) },
              },
              {
                id: 'call-read-b',
                type: 'function',
                function: { name: 'fs.read', arguments: JSON.stringify({ file: 'src/b.ts' }) },
              },
              {
                id: 'call-write-c',
                type: 'function',
                function: {
                  name: 'fs.write_file',
                  arguments: JSON.stringify({ file: 'src/c.ts', content: 'export {};\n' }),
                },
              },
            ],
          };
        }

        expect(toolMessages.map((message) => message.tool_call_id)).toEqual([
          'call-read-a',
          'call-read-b',
          'call-write-c',
        ]);
        return { role: 'assistant', content: 'DONE' };
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const finalPromise = chatWithTools(
      [{ role: 'user', content: 'inspect src/a.ts and src/b.ts, then write src/c.ts' }],
      {},
      {
        phase: Phase.AUTOPILOT,
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

    await Promise.all([readAStarted.promise, readBStarted.promise]);

    expect(executionOrder.slice(0, 2).sort()).toEqual([
      'fs.read:src/a.ts:start',
      'fs.read:src/b.ts:start',
    ]);
    expect(executionOrder).not.toContain('fs.write:src/c.ts:start');

    releaseReads.resolve();
    await writeStarted.promise;

    expect(executionOrder.indexOf('fs.write:src/c.ts:start')).toBeGreaterThan(
      executionOrder.indexOf('fs.read:src/a.ts:end'),
    );
    expect(executionOrder.indexOf('fs.write:src/c.ts:start')).toBeGreaterThan(
      executionOrder.indexOf('fs.read:src/b.ts:end'),
    );

    releaseWrite.resolve();
    const final = await finalPromise;

    expect(final.content).toBe('DONE');
    expect(round).toBe(2);
  });

  it('records tool result preview artifacts for large successful non-read tool results', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const largePayload = 'x'.repeat(1600);
    const spec: ToolSpec<{ q: string }, { result: string }> = {
      name: 'web.search',
      source: 'builtin',
      intent: 'SEARCH',
      description: 'Search web',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      executor: async () => ({ result: largePayload }),
    };
    registry.register(spec);

    const toolCallingAudit: any[] = [];
    const llm: LLM = {
      async chat(messages) {
        const toolMsg = messages.find((m) => m.role === 'tool');
        if (!toolMsg) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_preview',
                type: 'function',
                function: { name: 'web.search', arguments: JSON.stringify({ q: 'keyword' }) },
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
        toolCallingAudit: { event: (e) => toolCallingAudit.push(e) },
      },
    );

    expect(final.content).toBe('DONE');
    const previewEntry = toolCallingAudit.find(
      (e) => e.toolName === 'web.search' && e.toolResultStatus === 'ok',
    );
    expect(previewEntry).toBeTruthy();
    expect(previewEntry.toolResultPreviewArtifact?.handle).toContain('s8p://artifact/');
    expect(previewEntry.toolResultPreviewLabel).toContain('Tool result preview:');
  });

  it('throws interrupt errors from tool execution', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const interrupt = {
      type: 'awaiting_input',
      reason: 'clarification',
      prompt: 'Need input',
      data: { inputRequired: { type: 'question', prompt: 'Need input' } },
    };
    const askSpec: ToolSpec<{ prompt: string }, { ok: boolean }> = {
      name: 'interaction.ask_user',
      source: 'builtin',
      intent: 'INFRA',
      description: 'Ask user tool',
      riskLevel: 'low',
      sideEffects: ['none'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      executor: async () => {
        const err = new Error('User input required');
        (err as any).code = 'INTERRUPT_REQUIRED';
        (err as any).interrupt = interrupt;
        throw err;
      },
    };
    registry.register(askSpec);

    const llm: LLM = {
      async chat() {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'interaction.ask_user',
                arguments: JSON.stringify({ prompt: 'x' }),
              },
            },
          ],
        };
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    await expect(
      chatWithTools(
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
    ).rejects.toMatchObject({ code: 'INTERRUPT_REQUIRED', interrupt });
  });

  it('filters PLAN/PATCH tool payloads using the shared visibility resolver', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const register = (spec: Omit<ToolSpec, 'executor'>) =>
      registry.register({
        ...spec,
        executor: async () => ({}),
      });

    register({
      name: 'fs.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN, Phase.PATCH],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string() }),
    });
    register({
      name: 'code.search',
      source: 'builtin',
      intent: 'SEARCH',
      description: 'Search code',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN, Phase.PATCH],
      inputSchema: z.object({ pattern: z.string() }),
      outputSchema: z.object({ matches: z.array(z.any()) }),
    });
    register({
      name: 'fs.list',
      source: 'builtin',
      intent: 'LIST',
      description: 'List files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN, Phase.PATCH],
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ entries: z.array(z.string()) }),
    });
    register({
      name: 'plan.init',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Initialize runtime plan',
      riskLevel: 'low',
      sideEffects: ['runtime_write'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    });
    register({
      name: 'plan.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read runtime plan',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.PLAN, Phase.PATCH],
      inputSchema: z.object({ sessionId: z.string() }),
      outputSchema: z.object({ baseHash: z.string() }),
    });
    register({
      name: 'plan.update',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Update runtime plan',
      riskLevel: 'low',
      sideEffects: ['runtime_write'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.PLAN],
      inputSchema: z.object({}),
      outputSchema: z.object({}),
    });

    let lastOptions: any;
    const llm: LLM = {
      async chat(_messages, options) {
        lastOptions = options;
        return { role: 'assistant', content: 'DONE' };
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    await chatWithTools(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'prompt' },
      ],
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
        toolVisibility: { plan: { sessionId: 'sess', planPathHint: 'plan.md' } },
        toolstack: { registry, policy, router },
      },
    );

    const planToolNames = (lastOptions?.toolSpecs ?? []).map((spec: ToolSpec) => spec.name).sort();
    expect(planToolNames).toEqual(
      ['code.search', 'fs.list', 'fs.read', 'plan.read', 'plan.update'].sort(),
    );

    await chatWithTools(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'prompt' },
      ],
      {},
      {
        phase: Phase.PATCH,
        llm,
        runtime: {
          repoRoot: '/tmp',
          attemptId: 1,
          dryRun: true,
          model: 'test-model',
          worktreeRoot: '/tmp',
        },
        toolVisibility: { plan: { sessionId: 'sess', planPathHint: 'plan.md' } },
        toolstack: { registry, policy, router },
      },
    );

    const patchToolNames = (lastOptions?.toolSpecs ?? []).map((spec: ToolSpec) => spec.name).sort();
    expect(patchToolNames).toEqual(['code.search', 'fs.read'].sort());
  });

  it('keeps AUTOPILOT write tools visible only for direct autopilot sessions', async () => {
    const registry = new ToolRegistry();
    const policy = new ToolPolicy();
    const budget = new BudgetGuard();
    const audit = new ToolAuditLogger();
    const sanitizer = new ToolSanitizer();
    const router = new ToolRouter(registry, policy, budget, audit, sanitizer);

    const register = (spec: Omit<ToolSpec, 'executor'>) =>
      registry.register({
        ...spec,
        executor: async () => ({}),
      });

    register({
      name: 'code.search',
      source: 'builtin',
      intent: 'SEARCH',
      description: 'Search code',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ pattern: z.string(), cwd: z.string().optional() }),
      outputSchema: z.object({ matches: z.array(z.any()) }),
    });
    register({
      name: 'fs.read',
      source: 'builtin',
      intent: 'READ',
      description: 'Read files',
      riskLevel: 'low',
      sideEffects: ['fs_read'],
      concurrency: 'parallel_ok',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ file: z.string() }),
      outputSchema: z.object({ content: z.string() }),
    });
    register({
      name: 'fs.write_file',
      source: 'builtin',
      intent: 'WRITE',
      description: 'Write files',
      riskLevel: 'high',
      sideEffects: ['fs_write'],
      concurrency: 'serial_only',
      allowedPhases: [Phase.AUTOPILOT],
      inputSchema: z.object({ file: z.string(), content: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
    });

    let lastOptions: any;
    const llm: LLM = {
      async chat(_messages, options) {
        lastOptions = options;
        return { role: 'assistant', content: 'DONE' };
      },
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    await chatWithTools(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'prompt' },
      ],
      {},
      {
        phase: Phase.AUTOPILOT,
        llm,
        runtime: {
          repoRoot: '/tmp',
          attemptId: 1,
          dryRun: true,
          model: 'test-model',
          flowMode: 'autopilot',
        },
        toolstack: { registry, policy, router },
      },
    );

    const directAutopilotToolNames = (lastOptions?.toolSpecs ?? [])
      .map((spec: ToolSpec) => spec.name)
      .sort();
    expect(directAutopilotToolNames).toEqual(['code.search', 'fs.read', 'fs.write_file']);

    await chatWithTools(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'prompt' },
      ],
      {},
      {
        phase: Phase.AUTOPILOT,
        llm,
        runtime: {
          repoRoot: '/tmp',
          attemptId: 1,
          dryRun: true,
          model: 'test-model',
        },
        toolstack: { registry, policy, router },
      },
    );

    const phaseOnlyAutopilotToolNames = (lastOptions?.toolSpecs ?? [])
      .map((spec: ToolSpec) => spec.name)
      .sort();
    expect(phaseOnlyAutopilotToolNames).toEqual(['code.search', 'fs.read']);
  });
});
