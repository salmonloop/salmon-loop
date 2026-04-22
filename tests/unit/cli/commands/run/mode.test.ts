import { describe, expect, it } from 'bun:test';

import { resolveRunMode } from '../../../../../src/cli/commands/run/mode.js';

describe('resolveRunMode', () => {
  it('returns autopilot by default', () => {
    expect(resolveRunMode(undefined)).toBe('autopilot');
  });

  it('accepts patch, review, debug, research, answer, and autopilot', () => {
    expect(resolveRunMode('patch')).toBe('patch');
    expect(resolveRunMode('review')).toBe('review');
    expect(resolveRunMode('debug')).toBe('debug');
    expect(resolveRunMode('research')).toBe('research');
    expect(resolveRunMode('answer')).toBe('answer');
    expect(resolveRunMode('autopilot')).toBe('autopilot');
  });

  it('returns undefined for invalid values', () => {
    expect(resolveRunMode('unknown')).toBeUndefined();
  });
});
