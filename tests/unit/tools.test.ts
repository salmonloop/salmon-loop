import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { z } from 'zod';

import { ToolAuditLogger } from '../../src/core/tools/audit';
import { BudgetGuard } from '../../src/core/tools/budget';
import { ToolPolicy } from '../../src/core/tools/policy';
import { ToolRegistry } from '../../src/core/tools/registry';
import { ToolRouter } from '../../src/core/tools/router';
import { ToolSanitizer } from '../../src/core/tools/sanitize';
import { ToolSpec, ToolCallEnvelope } from '../../src/core/tools/types';

// Mock Tool Spec
const readToolSpec: ToolSpec = {
  name: 'fs.read',
  source: 'builtin',
  description: 'A read tool',
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  inputSchema: z.object({ path: z.string() }),
  outputSchema: z.object({ content: z.string() }),
  allowedPhases: ['CONTEXT'],
  executor: async (input: any) => ({ content: `content of ${input.path}` }),
};

describe('Tool System', () => {
  describe('ToolPolicy', () => {
    const policy = new ToolPolicy();

    it('should allow read tools in CONTEXT phase', () => {
      const decision = policy.decide('CONTEXT', readToolSpec, {});
      expect(decision.allowed).toBe(true);
    });

    it('should deny tools in PLAN phase by default', () => {
      const decision = policy.decide('PLAN', readToolSpec, {});
      expect(decision.allowed).toBe(false);
      expect(decision.denyReason).toContain('not allowed in phase PLAN');
    });

    it('should require worktree for tools with side effects', () => {
      const writeToolSpec: ToolSpec = {
        ...readToolSpec,
        sideEffects: ['fs_write'],
        name: 'fs.write',
      };
      const decision = policy.decide('CONTEXT', writeToolSpec, {
        worktreeRoot: undefined,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denyReason).toContain('requires worktree');

      const allowedDecision = policy.decide('CONTEXT', writeToolSpec, {
        worktreeRoot: '/tmp/worktree',
      });
      expect(allowedDecision.allowed).toBe(true);
    });

    it('should allow pure tools (no side effects) without worktree', () => {
      const pureTool: ToolSpec = { ...readToolSpec, sideEffects: ['none'], name: 'pure' };
      const decision = policy.decide('CONTEXT', pureTool, {});
      expect(decision.allowed).toBe(true);
    });
  });

  describe('BudgetGuard', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should timeout execution', async () => {
      vi.useFakeTimers();
      const budget = new BudgetGuard();

      const slowFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return 'done';
      };

      const p = budget.runWithGuards({
        timeoutMs: 50,
        maxOutputBytes: 1000,
        phase: 'CONTEXT',
        toolName: 'slow',
        riskLevel: 'low',
        fn: slowFn,
      });

      vi.advanceTimersByTime(100);

      await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    });

    it('should respect concurrency limits', async () => {
      const budget = new BudgetGuard({
        maxConcurrentByRisk: { low: 2, medium: 3, high: 1 },
        maxCallsPerPhase: 10,
      });
      const fn = async () => new Promise((resolve) => setTimeout(resolve, 10));

      const _p1 = budget.runWithGuards({
        timeoutMs: 100,
        maxOutputBytes: 100,
        phase: 'CONTEXT',
        toolName: 't1',
        riskLevel: 'low',
        fn,
      });
      const _p2 = budget.runWithGuards({
        timeoutMs: 100,
        maxOutputBytes: 100,
        phase: 'CONTEXT',
        toolName: 't2',
        riskLevel: 'low',
        fn,
      });

      const p3 = budget.runWithGuards({
        timeoutMs: 100,
        maxOutputBytes: 100,
        phase: 'CONTEXT',
        toolName: 't3',
        riskLevel: 'low',
        fn,
      });

      await expect(p3).rejects.toMatchObject({ code: 'BUDGET_CONCURRENCY' });
    });
  });

  describe('ToolRouter', () => {
    let router: ToolRouter;
    let registry: ToolRegistry;

    beforeEach(() => {
      registry = new ToolRegistry();
      router = new ToolRouter(
        registry,
        new ToolPolicy(),
        new BudgetGuard(),
        new ToolAuditLogger(),
        new ToolSanitizer(),
      );
    });

    it('should execute a valid tool call', async () => {
      const echoTool: ToolSpec = {
        name: 'test.echo',
        source: 'builtin',
        description: 'Echo',
        riskLevel: 'low',
        sideEffects: ['none'],
        inputSchema: z.object({ msg: z.string() }),
        outputSchema: z.object({ msg: z.string() }),
        allowedPhases: ['CONTEXT'],
        executor: async (input: any) => ({ msg: input.msg }),
      };

      registry.register(echoTool);

      const envelope: ToolCallEnvelope = {
        id: '123',
        phase: 'CONTEXT',
        toolName: 'test.echo',
        args: { msg: 'hello' },
        ctx: { repoRoot: '/tmp', attemptId: 1, dryRun: false },
      };

      const result = await router.call(envelope);

      expect(result.status).toBe('ok');
      expect(result.output).toEqual({ msg: 'hello' });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should reject invalid input', async () => {
      const echoTool: ToolSpec = {
        name: 'test.echo',
        source: 'builtin',
        description: 'Echo',
        riskLevel: 'low',
        sideEffects: ['none'],
        inputSchema: z.object({ msg: z.string() }),
        outputSchema: z.object({ msg: z.string() }),
        allowedPhases: ['CONTEXT'],
        executor: async () => ({ msg: 'should not reach here' }),
      };

      registry.register(echoTool);

      const envelope: ToolCallEnvelope = {
        id: '123',
        phase: 'CONTEXT',
        toolName: 'test.echo',
        args: { msg: 123 }, // Invalid type
        ctx: { repoRoot: '/tmp', attemptId: 1, dryRun: false },
      };

      const result = await router.call(envelope);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('INVALID_INPUT');
    });
  });
});
