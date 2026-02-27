import { describe, expect, it } from 'bun:test';

import { ConfigError } from '../../../src/core/config/errors.js';
import { createContextCacheStore } from '../../../src/core/context/cache/store-factory.js';
import {
  MemoryContextCacheStore,
  PersistentContextCacheStore,
} from '../../../src/core/context/cache/store.js';

describe('createContextCacheStore', () => {
  it('defaults to memory store when cache mode is not configured', async () => {
    const created = await createContextCacheStore('/repo', undefined);
    expect(created.store).toBeInstanceOf(MemoryContextCacheStore);
  });

  it('creates persistent store when cache.mode is persistent', async () => {
    const created = await createContextCacheStore('/repo', {
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

  it('throws when persistent cache path is outside allowed roots', async () => {
    await expect(
      createContextCacheStore('/repo', {
        context: {
          cache: {
            mode: 'persistent',
            path: '../outside/context-cache.json',
            allowedRoots: ['.salmonloop/cache'],
          },
        },
      } as any),
    ).rejects.toThrow(new ConfigError('PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT'));
  });

  it('allows outside cache root with permission gate', async () => {
    const created = await createContextCacheStore(
      '/repo',
      {
        context: {
          cache: {
            mode: 'persistent',
            path: '../outside/context-cache.json',
            allowedRoots: ['.salmonloop/cache'],
          },
        },
      } as any,
      {
        permissionGate: {
          requestAuthorization: async () => ({ kind: 'allow', source: 'cli' as const }),
        },
      },
    );
    expect(created.store).toBeInstanceOf(PersistentContextCacheStore);
  });
});
