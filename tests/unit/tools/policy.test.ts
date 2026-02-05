import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolSpec } from '../../../src/core/tools/types.js';
import { Phase } from '../../../src/core/types.js';

describe('ToolPolicy', () => {
  let policy: ToolPolicy;

  beforeEach(() => {
    policy = new ToolPolicy();
  });

  const createMockSpec = (
    name: string,
    sideEffects: any[] = ['none'],
    riskLevel: any = 'low',
  ): ToolSpec => ({
    name,
    source: 'builtin',
    description: 'test',
    riskLevel,
    sideEffects,
    concurrency: 'serial_only',
    allowedPhases: [],
    inputSchema: {} as any,
    outputSchema: {} as any,
    executor: async () => ({}),
  });

  it('should strictly forbid ANY tool call in APPLY phase', () => {
    const spec = createMockSpec('fs.read', ['fs_read']);
    const decision = policy.decide(Phase.APPLY, spec, { worktreeRoot: '/tmp' } as any);

    expect(decision.allowed).toBe(false);
    expect(decision.denyReason).toContain('is not allowed in phase');
  });

  it('should forbid mutation tools in PLAN phase', () => {
    const spec = createMockSpec('fs.write', ['fs_write']);
    const decision = policy.decide(Phase.PLAN, spec, { worktreeRoot: '/tmp' } as any);

    expect(decision.allowed).toBe(false);
    expect(decision.denyReason).toContain('is not allowed in phase');
  });

  it('should forbid mutation tools in PATCH phase', () => {
    const spec = createMockSpec('git.commit', ['git_write']);
    const decision = policy.decide(Phase.PATCH, spec, { worktreeRoot: '/tmp' } as any);

    expect(decision.allowed).toBe(false);
    expect(decision.denyReason).toContain('is not allowed in phase');
  });

  it('should allow read-only tools in CONTEXT phase', () => {
    const spec = createMockSpec('fs.read', ['fs_read']);
    const decision = policy.decide(Phase.CONTEXT, spec, { worktreeRoot: '/tmp' } as any);

    expect(decision.allowed).toBe(true);
  });

  it('should forbid tools with side effects without a worktreeRoot', () => {
    const spec = createMockSpec('process.exec', ['process']);
    const decision = policy.decide(Phase.VERIFY, spec, {} as any); // No worktreeRoot

    expect(decision.allowed).toBe(false);
    expect(decision.denyReason).toContain('requires worktree isolation');
  });

  it('should respect explicitly allowed phases in ToolSpec', () => {
    const spec = createMockSpec('custom.tool');
    spec.allowedPhases = [Phase.PLAN] as any;

    // Normally allowed in CONTEXT, but spec restricts it to PLAN
    const decision = policy.decide(Phase.CONTEXT, spec, { worktreeRoot: '/tmp' } as any);
    expect(decision.allowed).toBe(false);
  });
});
