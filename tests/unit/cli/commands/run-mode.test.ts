import { describe, expect, it } from 'bun:test';

import { resolveRunMode } from '../../../../src/cli/commands/run/mode.js';

describe('resolveRunMode', () => {
  it('accepts autopilot as a first-class flow mode', () => {
    expect(resolveRunMode('autopilot')).toBe('autopilot');
  });

  it('keeps rejecting unknown flow modes', () => {
    expect(resolveRunMode('unknown-mode')).toBeUndefined();
  });
});
