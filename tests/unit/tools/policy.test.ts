import { proposalApplySpec } from '../../../src/core/tools/builtin/proposal.js';
import { shellExecSpec } from '../../../src/core/tools/builtin/shell.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolSpec } from '../../../src/core/tools/types.js';
import { Phase } from '../../../src/core/types/index.js';

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
    intent: 'INFRA',
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

  it('allows side-effect tools in AUTOPILOT when flowMode=autopilot', () => {
    const processSpec = createMockSpec('process.exec', ['process']);
    processSpec.allowedPhases = [Phase.AUTOPILOT] as any;
    const networkSpec = createMockSpec('network.fetch', ['network']);
    networkSpec.allowedPhases = [Phase.AUTOPILOT] as any;

    expect(
      policy.decide(Phase.AUTOPILOT, processSpec, { flowMode: 'autopilot' } as any).allowed,
    ).toBe(true);
    expect(
      policy.decide(Phase.AUTOPILOT, networkSpec, { flowMode: 'autopilot' } as any).allowed,
    ).toBe(true);
  });

  it('does not let non-autopilot callers bypass isolation by using AUTOPILOT phase', () => {
    const processSpec = createMockSpec('process.exec', ['process']);
    processSpec.allowedPhases = [Phase.AUTOPILOT] as any;
    const networkSpec = createMockSpec('network.fetch', ['network']);
    networkSpec.allowedPhases = [Phase.AUTOPILOT] as any;

    expect(policy.decide(Phase.AUTOPILOT, processSpec, {} as any).allowed).toBe(false);
    expect(policy.decide(Phase.AUTOPILOT, networkSpec, {} as any).allowed).toBe(false);
  });

  it('allows shell.exec in direct AUTOPILOT runtime', () => {
    const decision = policy.decide(
      Phase.AUTOPILOT,
      shellExecSpec as any,
      {
        flowMode: 'autopilot',
      } as any,
    );

    expect(decision.allowed).toBe(true);
  });

  it('should respect explicitly allowed phases in ToolSpec', () => {
    const spec = createMockSpec('custom.tool');
    spec.allowedPhases = [Phase.PLAN] as any;

    // Normally allowed in CONTEXT, but spec restricts it to PLAN
    const decision = policy.decide(Phase.CONTEXT, spec, { worktreeRoot: '/tmp' } as any);
    expect(decision.allowed).toBe(false);
  });

  it('should allow proposal.apply only in VERIFY phase', () => {
    const spec: ToolSpec = {
      ...(proposalApplySpec as any),
      executor: async () => ({}),
    };

    const verifyDecision = policy.decide(Phase.VERIFY, spec, { worktreeRoot: '/tmp' } as any);
    expect(verifyDecision.allowed).toBe(true);

    const applyDecision = policy.decide(Phase.APPLY, spec, { worktreeRoot: '/tmp' } as any);
    expect(applyDecision.allowed).toBe(false);
  });
});
