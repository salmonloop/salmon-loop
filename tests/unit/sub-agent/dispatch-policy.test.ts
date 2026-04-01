import { describe, expect, it } from 'bun:test';

import { isReadOnlyModelPhase, resolveSubAgentDryRun } from '../../../src/core/sub-agent/dispatch-policy.js';

describe('sub-agent dispatch policy', () => {
  it('identifies read-only model phases correctly', () => {
    expect(isReadOnlyModelPhase('EXPLORE')).toBe(true);
    expect(isReadOnlyModelPhase('PLAN')).toBe(true);
    expect(isReadOnlyModelPhase('PATCH')).toBe(true);
    expect(isReadOnlyModelPhase('VERIFY')).toBe(false);
    expect(isReadOnlyModelPhase(undefined)).toBe(false);
  });

  it('forces dryRun in read-only model phases', () => {
    expect(resolveSubAgentDryRun(false, 'PLAN')).toBe(true);
    expect(resolveSubAgentDryRun(true, 'PLAN')).toBe(true);
    expect(resolveSubAgentDryRun(false, 'VERIFY')).toBe(false);
    expect(resolveSubAgentDryRun(true, 'VERIFY')).toBe(true);
  });
});
