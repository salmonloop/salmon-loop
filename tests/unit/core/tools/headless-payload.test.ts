import { describe, expect, it } from 'vitest';

import { buildHeadlessToolInputPayload } from '../../../../src/core/tools/headless-payload.js';

describe('buildHeadlessToolInputPayload', () => {
  it('returns undefined for non-record values', () => {
    expect(buildHeadlessToolInputPayload('x')).toBeUndefined();
    expect(buildHeadlessToolInputPayload(null)).toBeUndefined();
    expect(buildHeadlessToolInputPayload([1, 2, 3])).toBeUndefined();
  });

  it('redacts secret-like keys and limits shape', () => {
    const payload = buildHeadlessToolInputPayload({
      apiKey: 'sk-secret',
      nested: {
        password: 'p',
        deep: { more: { evenMore: { tooDeep: { x: 1 } } } },
      },
      arr: Array.from({ length: 100 }, (_, i) => ({ i })),
    });

    expect(payload).toBeTruthy();
    expect(payload).toMatchObject({
      apiKey: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });

    const arr = (payload as any).arr as unknown[];
    expect(arr.length).toBeLessThanOrEqual(40);
  });
});
