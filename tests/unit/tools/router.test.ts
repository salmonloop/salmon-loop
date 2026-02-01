import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { BudgetGuard } from '../../../src/core/tools/budget.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import { ToolRouter } from '../../../src/core/tools/router.js';
import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';
import { Phase } from '../../../src/core/types.js';

describe('ToolRouter', () => {
  let router: ToolRouter;
  let registry: ToolRegistry;
  let policy: ToolPolicy;
  let budget: BudgetGuard;
  let audit: ToolAuditLogger;
  let sanitizer: ToolSanitizer;

  beforeEach(() => {
    // Mocking dependencies for strict pipeline verification
    registry = { getSpec: vi.fn() } as any;
    policy = { decide: vi.fn() } as any;
    budget = { runWithGuards: vi.fn() } as any;
    audit = { onStart: vi.fn(), onEnd: vi.fn() } as any;
    sanitizer = { validateInput: vi.fn(), sanitizeOutput: vi.fn() } as any;

    router = new ToolRouter(registry, policy, budget, audit, sanitizer);
  });

  it('should enforce the full execution pipeline for a successful call', async () => {
    const mockSpec = {
      name: 'test.tool',
      source: 'builtin',
      riskLevel: 'low',
      executor: vi.fn().mockResolvedValue('raw output'),
    };
    const envelope = {
      id: 'call_1',
      toolName: 'test.tool',
      args: { input: 'data' },
      phase: Phase.CONTEXT,
      ctx: { repoRoot: '/tmp' } as any,
    };

    (registry.getSpec as any).mockReturnValue(mockSpec);
    (sanitizer.validateInput as any).mockReturnValue({ ok: true });
    (policy.decide as any).mockReturnValue({ allowed: true });
    (budget.runWithGuards as any).mockImplementation(({ fn }: any) => fn());
    (sanitizer.sanitizeOutput as any).mockReturnValue({
      ok: true,
      output: 'safe output',
      summary: 'done',
    });

    const result = await router.call(envelope);

    // Verify Audit Trail
    expect(audit.onStart).toHaveBeenCalledWith(envelope, mockSpec, { allowed: true });
    expect(audit.onEnd).toHaveBeenCalled();

    // Verify Policy Gate
    expect(policy.decide).toHaveBeenCalledWith(Phase.CONTEXT, mockSpec, envelope.ctx);

    // Verify Result
    expect(result.status).toBe('ok');
    expect(result.output).toBe('safe output');
  });

  it('should block execution if Policy denies the call', async () => {
    const mockSpec = { name: 'write.file', source: 'builtin' };
    const envelope = { id: 'call_2', toolName: 'write.file', phase: Phase.PLAN, args: {} } as any;

    (registry.getSpec as any).mockReturnValue(mockSpec);
    (sanitizer.validateInput as any).mockReturnValue({ ok: true });
    (policy.decide as any).mockReturnValue({ allowed: false, denyReason: 'No writes in PLAN' });

    const result = await router.call(envelope);

    expect(result.status).toBe('denied');
    expect(result.error?.code).toBe('POLICY_DENY');
    expect(budget.runWithGuards).not.toHaveBeenCalled();
    expect(audit.onEnd).toHaveBeenCalledWith(expect.objectContaining({ status: 'denied' }));
  });

  it('should handle tool not found', async () => {
    const envelope = { id: 'call_3', toolName: 'unknown.tool' } as any;
    (registry.getSpec as any).mockReturnValue(null);

    const result = await router.call(envelope);

    expect(result.status).toBe('denied');
    expect(result.error?.code).toBe('TOOL_NOT_FOUND');
    expect(audit.onEnd).toHaveBeenCalled();
  });

  it('should map execution timeout to "timeout" status and TIMEOUT code', async () => {
    const mockSpec = { name: 'long.tool', source: 'builtin', riskLevel: 'low' };
    const envelope = { id: 'call_4', toolName: 'long.tool', phase: Phase.PATCH, args: {} } as any;

    (registry.getSpec as any).mockReturnValue(mockSpec);
    (sanitizer.validateInput as any).mockReturnValue({ ok: true });
    (policy.decide as any).mockReturnValue({ allowed: true });
    (budget.runWithGuards as any).mockRejectedValue({
      code: 'TIMEOUT',
      message: 'Execution timed out',
    });

    const result = await router.call(envelope);

    expect(result.status).toBe('timeout');
    expect(result.error?.code).toBe('TIMEOUT');
  });

  it('should ensure the "Zero Index Access" context is passed correctly', async () => {
    const mockSpec = {
      name: 'fs.read',
      source: 'builtin',
      executor: vi.fn().mockResolvedValue('content'),
    };
    const ctx = { repoRoot: '/project/root', env: { GIT_DIR: '.git' } };
    const envelope = {
      id: 'call_5',
      toolName: 'fs.read',
      args: { path: 'file.txt' },
      phase: Phase.CONTEXT,
      ctx,
    } as any;

    (registry.getSpec as any).mockReturnValue(mockSpec);
    (sanitizer.validateInput as any).mockReturnValue({ ok: true });
    (policy.decide as any).mockReturnValue({ allowed: true });
    (budget.runWithGuards as any).mockImplementation(({ fn }: any) => fn());
    (sanitizer.sanitizeOutput as any).mockReturnValue({ ok: true, output: 'content' });

    await router.call(envelope);

    expect(mockSpec.executor).toHaveBeenCalledWith(envelope.args, expect.objectContaining(ctx));
    expect(mockSpec.executor).toHaveBeenCalledWith(
      envelope.args,
      expect.objectContaining({ phase: Phase.CONTEXT }),
    );
  });
});
