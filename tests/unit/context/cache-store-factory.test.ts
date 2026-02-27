import { describe, expect, it } from 'bun:test';

import { ConfigError } from '../../../src/core/config/errors.js';
import { createContextCacheStore } from '../../../src/core/context/cache/store-factory.js';
import {
  MemoryContextCacheStore,
  PersistentContextCacheStore,
} from '../../../src/core/context/cache/store.js';

describe('createContextCacheStore', () => {
  it('defaults to memory store when cache mode is not configured', () => {
    const created = createContextCacheStore('/repo', undefined);
    expect(created.store).toBeInstanceOf(MemoryContextCacheStore);
  });

  it('creates persistent store when cache.mode is persistent', () => {
    const created = createContextCacheStore('/repo', {
      context: {
        cache: {
          mode: 'persistent',
          path: '.salmonloop/cache/custom.json',
          allowedRoots: ['.salmonloop/cache'],
          maxEntries: 12,
          ttlMs: 3456,
        },
      },
    } as any);
    expect(created.store).toBeInstanceOf(PersistentContextCacheStore);
    expect(created.maxEntries).toBe(12);
    expect(created.ttlMs).toBe(3456);
  });

  it('throws when persistent cache path is outside allowed roots', () => {
    expect(() =>
      createContextCacheStore('/repo', {
        context: {
          cache: {
            mode: 'persistent',
            path: '../outside/context-cache.json',
            allowedRoots: ['.salmonloop/cache'],
          },
        },
      } as any),
    ).toThrow(new ConfigError('CONFIG_INVALID_CONTEXT_CACHE_PATH_NOT_ALLOWED'));
  });
});
