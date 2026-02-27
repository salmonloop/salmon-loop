import { describe, expect, it } from 'bun:test';

import { EXECUTION_PHASES, Phase } from '../../../../src/core/types/execution.js';

describe('execution phase order', () => {
  it('includes PREPARE_DEPS immediately after PREFLIGHT', () => {
    const preflightIndex = EXECUTION_PHASES.indexOf(Phase.PREFLIGHT);
    const prepareDepsIndex = EXECUTION_PHASES.indexOf('PREPARE_DEPS');

    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(prepareDepsIndex).toBe(preflightIndex + 1);
  });
});
