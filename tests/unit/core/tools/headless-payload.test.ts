import { describe, expect, it } from 'bun:test';

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

  it('redacts secret-looking values even when the containing key is not sensitive', () => {
    const payload = buildHeadlessToolInputPayload({
      command: 'curl -H "Authorization: Bearer sk-live-1234567890abcdef" https://example.test',
      content: 'api_key="sk-live-abcdef1234567890" token=plain-secret-value',
      task: 'Use sk-1234567890abcdef1234567890abcdef to call the service',
    });

    expect(JSON.stringify(payload)).not.toContain('sk-live-1234567890abcdef');
    expect(JSON.stringify(payload)).not.toContain('sk-live-abcdef1234567890');
    expect(JSON.stringify(payload)).not.toContain('plain-secret-value');
    expect(JSON.stringify(payload)).not.toContain('sk-1234567890abcdef1234567890abcdef');
    expect(payload).toMatchObject({
      command: expect.stringContaining('Bearer [REDACTED]'),
      content: expect.stringContaining('api_key=[REDACTED]'),
      task: expect.stringContaining('[REDACTED]'),
    });
  });
});
