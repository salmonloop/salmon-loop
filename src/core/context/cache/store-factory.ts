import type { ConfigFileV1 } from '../../config/types.js';
import type { PermissionGate } from '../../permission-gate/gate.js';

import { resolveContextCachePath } from './path-resolver.js';
import {
  MemoryContextCacheStore,
  PersistentContextCacheStore,
  type ContextCacheStore,
} from './store.js';

export async function createContextCacheStore(
  repoPath: string,
  rawConfig?: ConfigFileV1,
  options?: { permissionGate?: PermissionGate },
): Promise<{
  store: ContextCacheStore;
  maxEntries?: number;
  ttlMs?: number;
}> {
  const cacheConfig = rawConfig?.context?.cache;
  const pathResolution = await resolveContextCachePath(repoPath, rawConfig, options);
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
