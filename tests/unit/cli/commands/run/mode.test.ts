import { describe, expect, it } from 'bun:test';

import { resolveRunMode } from '../../../../../src/cli/commands/run/mode.js';

describe('resolveRunMode', () => {
  it('returns patch by default', () => {
    expect(resolveRunMode(undefined)).toBe('patch');
  });

  it('accepts review, debug, and research', () => {
    expect(resolveRunMode('review')).toBe('review');
    expect(resolveRunMode('debug')).toBe('debug');
    expect(resolveRunMode('research')).toBe('research');
  });

  it('returns undefined for invalid values', () => {
    expect(resolveRunMode('unknown')).toBeUndefined();
  });
});
