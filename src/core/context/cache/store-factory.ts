import type { ConfigFileV1 } from '../../config/types.js';

import { resolveContextCachePath } from './path-resolver.js';
import {
  MemoryContextCacheStore,
  PersistentContextCacheStore,
  type ContextCacheStore,
} from './store.js';

export function createContextCacheStore(
  repoPath: string,
  rawConfig?: ConfigFileV1,
): {
  store: ContextCacheStore;
  maxEntries?: number;
  ttlMs?: number;
} {
  const cacheConfig = rawConfig?.context?.cache;
  const pathResolution = resolveContextCachePath(repoPath, rawConfig);
  const maxEntries =
    typeof cacheConfig?.maxEntries === 'number' && cacheConfig.maxEntries > 0
      ? Math.floor(cacheConfig.maxEntries)
      : undefined;
  const ttlMs =
    typeof cacheConfig?.ttlMs === 'number' && cacheConfig.ttlMs > 0
      ? Math.floor(cacheConfig.ttlMs)
      : undefined;

  if (pathResolution.mode === 'persistent' && pathResolution.filePath) {
    return {
      store: new PersistentContextCacheStore(pathResolution.filePath, { strict: true }),
      maxEntries,
      ttlMs,
    };
  }

  return { store: new MemoryContextCacheStore(), maxEntries, ttlMs };
}
