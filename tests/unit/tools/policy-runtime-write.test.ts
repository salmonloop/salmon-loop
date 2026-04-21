import { describe, expect, it } from 'bun:test';

import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { Phase } from '../../../src/core/types/index.js';

describe('ToolPolicy runtime_write exemption', () => {
  it('allows plan.* runtime_write in PLAN without worktree', () => {
    const policy = new ToolPolicy();
    const decision = policy.decide(
      Phase.PLAN,
      {
        name: 'plan.update',
        sideEffects: ['runtime_write'],
        allowedPhases: [Phase.PLAN],
        riskLevel: 'low',
      } as any,
      {},
    );
    expect(decision.allowed).toBe(true);
  });

  it('denies runtime_write for non-plan tools', () => {
    const policy = new ToolPolicy();
    const decision = policy.decide(
      Phase.PLAN,
      {
        name: 'fs.write',
        sideEffects: ['runtime_write'],
        allowedPhases: [Phase.PLAN],
        riskLevel: 'low',
      } as any,
      {},
    );
    expect(decision.allowed).toBe(false);
  });

  it('does not let direct autopilot bypass the runtime_write restriction', () => {
    const policy = new ToolPolicy();
    const decision = policy.decide(
      Phase.AUTOPILOT,
      {
        name: 'fs.write',
        sideEffects: ['runtime_write'],
        allowedPhases: [Phase.AUTOPILOT],
        riskLevel: 'low',
      } as any,
      { flowMode: 'autopilot' },
    );
    expect(decision.allowed).toBe(false);
  });
});
