import { describe, expect, it } from 'vitest';

import { getExitCode, EXIT_CODES } from '../../../../src/core/runtime/exit-codes.js';

describe('getExitCode', () => {
  it('returns 130 for user cancellation', () => {
    expect(getExitCode({ success: false, reason: 'Operation cancelled by user' } as any)).toBe(
      EXIT_CODES.cancelled,
    );
  });

  it('returns 0 on success', () => {
    expect(getExitCode({ success: true, reason: 'SUCCESS' } as any)).toBe(EXIT_CODES.success);
  });

  it('returns 1 on failure', () => {
    expect(getExitCode({ success: false, reason: 'LOOP_FAILED' } as any)).toBe(EXIT_CODES.failure);
  });
});
