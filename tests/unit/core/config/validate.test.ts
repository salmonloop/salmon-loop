import { describe, expect, it } from 'bun:test';

import { validateConfigFileV1 } from '../../../../src/core/config/validate.js';

describe('validateConfigFileV1 (context.cache)', () => {
  it('accepts persistent cache with path and allowedRoots', () => {
    const parsed = validateConfigFileV1({
      context: {
        cache: {
          mode: 'persistent',
          path: '.salmonloop/cache/context-cache.json',
          allowedRoots: ['.salmonloop/cache'],
        },
      },
    });

    expect(parsed.context?.cache?.mode).toBe('persistent');
    expect(parsed.context?.cache?.allowedRoots).toEqual(['.salmonloop/cache']);
  });

  it('rejects persistent cache without allowedRoots', () => {
    expect(() =>
      validateConfigFileV1({
        context: {
          cache: {
            mode: 'persistent',
            path: '.salmonloop/cache/context-cache.json',
          },
        },
      }),
    ).toThrow(/CONFIG_INVALID_CONTEXT_CACHE_ALLOWED_ROOTS/);
  });
});
