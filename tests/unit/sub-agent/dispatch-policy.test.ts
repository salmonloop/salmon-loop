import { describe, expect, it } from 'bun:test';

import {
  isReadOnlyModelPhase,
  isReadOnlySubAgentContext,
  resolveSubAgentDryRun,
} from '../../../src/core/sub-agent/dispatch-policy.js';

describe('sub-agent dispatch policy', () => {
  it('identifies read-only model phases correctly', () => {
    expect(isReadOnlyModelPhase('EXPLORE')).toBe(true);
    expect(isReadOnlyModelPhase('PLAN')).toBe(true);
    expect(isReadOnlyModelPhase('PATCH')).toBe(true);
    expect(isReadOnlyModelPhase('VERIFY')).toBe(false);
    expect(isReadOnlyModelPhase(undefined)).toBe(false);
  });

  it('forces dryRun in read-only model phases', () => {
    expect(resolveSubAgentDryRun({ parentDryRun: false, phase: 'PLAN' })).toBe(true);
    expect(resolveSubAgentDryRun({ parentDryRun: true, phase: 'PLAN' })).toBe(true);
    expect(resolveSubAgentDryRun({ parentDryRun: false, phase: 'VERIFY' })).toBe(false);
    expect(resolveSubAgentDryRun({ parentDryRun: true, phase: 'VERIFY' })).toBe(true);
  });

  it('treats autopilot contexts as writable even when borrowing a legacy read-only phase', () => {
    expect(isReadOnlySubAgentContext({ flowMode: 'autopilot', phase: 'EXPLORE' })).toBe(false);
    expect(
      resolveSubAgentDryRun({
        parentDryRun: false,
        flowMode: 'autopilot',
        phase: 'EXPLORE',
      }),
    ).toBe(false);
  });

  it('preserves read-only phase semantics for recipe flows', () => {
    expect(isReadOnlySubAgentContext({ flowMode: 'patch', phase: 'EXPLORE' })).toBe(true);
    expect(
      resolveSubAgentDryRun({
        parentDryRun: false,
        flowMode: 'patch',
        phase: 'EXPLORE',
      }),
    ).toBe(true);
  });
});
