import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { ConfigError } from '../../../src/core/config/errors.js';

const resolveContextCachePathMock = mock();
mock.module('../../../src/core/context/cache/path-resolver.js', () => ({
  resolveContextCachePath: () => resolveContextCachePathMock(),
}));

const persistentCtorMock = mock();
const persistentSizeMock = mock();

class PersistentStoreMock {
  constructor(filePath: string, options: Record<string, unknown>) {
    persistentCtorMock(filePath, options);
  }

  async size() {
    return persistentSizeMock();
  }
}

class MemoryStoreMock {}

mock.module('../../../src/core/context/cache/store.js', () => ({
  MemoryContextCacheStore: MemoryStoreMock,
  PersistentContextCacheStore: PersistentStoreMock,
}));

async function loadFactory() {
  return await import('../../../src/core/context/cache/store-factory.js');
}

describe('createContextCacheStore', () => {
  beforeEach(() => {
    resolveContextCachePathMock.mockClear();
    persistentCtorMock.mockClear();
    persistentSizeMock.mockClear();
  });

  it('defaults to memory store when cache mode is not configured', async () => {
    resolveContextCachePathMock.mockResolvedValue({ mode: 'memory' });
    const { createContextCacheStore } = await loadFactory();
    const created = await createContextCacheStore('/repo', undefined);
    expect(created.store).toBeInstanceOf(MemoryStoreMock);
    expect(persistentCtorMock).not.toHaveBeenCalled();
  });

  it('creates persistent store when path resolution returns persistent mode', async () => {
    resolveContextCachePathMock.mockResolvedValue({
      mode: 'persistent',
      filePath: '/repo/.salmonloop/cache.json',
    });
    const { createContextCacheStore } = await loadFactory();
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

    expect(created.store).toBeInstanceOf(PersistentStoreMock);
    expect(created.maxEntries).toBe(12);
    expect(created.ttlMs).toBe(3456);
    expect(persistentCtorMock).toHaveBeenCalledWith(
      '/repo/.salmonloop/cache.json',
      expect.objectContaining({
        strict: true,
        fallbackMode: 'fail',
      }),
    );
  });

  it('propagates ConfigError from path resolver', async () => {
    resolveContextCachePathMock.mockRejectedValue(
      new ConfigError('PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT'),
    );
    const { createContextCacheStore } = await loadFactory();
    await expect(
      createContextCacheStore('/repo', {
        context: {
          cache: {
            mode: 'persistent',
          },
        },
      } as any),
    ).rejects.toThrow(ConfigError);
  });

  it('passes strict false and fallback memory options when configured', async () => {
    resolveContextCachePathMock.mockResolvedValue({
      mode: 'persistent',
      filePath: '/repo/.salmonloop/cache.json',
    });
    const { createContextCacheStore } = await loadFactory();
    await createContextCacheStore('/repo', {
      context: {
        cache: {
          mode: 'persistent',
          path: '.salmonloop/cache/custom.json',
          allowedRoots: ['.salmonloop/cache'],
          strict: false,
          fallbackToMemoryOnFailure: true,
        },
      },
    } as any);

    expect(persistentCtorMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        strict: false,
        fallbackMode: 'memory',
      }),
    );
  });

  it('falls back to memory store when persistent store fails to load', async () => {
    resolveContextCachePathMock.mockResolvedValue({
      mode: 'persistent',
      filePath: '/repo/.salmonloop/cache.json',
    });
    persistentSizeMock.mockRejectedValue(new Error('boom'));
    const { createContextCacheStore } = await loadFactory();
    const created = await createContextCacheStore('/repo', {
      context: {
        cache: {
          mode: 'persistent',
          path: '.salmonloop/cache/custom.json',
          allowedRoots: ['.salmonloop/cache'],
          fallbackToMemoryOnFailure: true,
        },
      },
    } as any);

    expect(created.store).toBeInstanceOf(MemoryStoreMock);
  });
});
