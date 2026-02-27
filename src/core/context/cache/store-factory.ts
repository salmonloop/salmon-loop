import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import type { ConfigFileV1 } from '../../config/types.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import type { PermissionGate } from '../../permission-gate/gate.js';

import { resolveContextCachePath } from './path-resolver.js';
import {
  MemoryContextCacheStore,
  PersistentContextCacheStore,
  type ContextCacheStore,
  type PersistentContextCacheStoreOptions,
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
  const maxPayloadBytes =
    typeof cacheConfig?.maxPayloadBytes === 'number' && cacheConfig.maxPayloadBytes > 0
      ? Math.floor(cacheConfig.maxPayloadBytes)
      : undefined;

  const fallbackToMemoryOnFailure = Boolean(cacheConfig?.fallbackToMemoryOnFailure);
  const cacheStrict = fallbackToMemoryOnFailure ? false : (cacheConfig?.strict ?? true);
  const fallbackMode: PersistentContextCacheStoreOptions['fallbackMode'] = fallbackToMemoryOnFailure
    ? 'memory'
    : 'fail';
  const cleanupAdapter = new FileAdapter();
  const cleanupFn: PersistentContextCacheStoreOptions['cleanupFn'] = async (details) => {
    try {
      await cleanupAdapter.deleteFile(details.filePath);
    } catch {
      // best-effort cleanup only
    }
  };

  if (pathResolution.mode === 'persistent' && pathResolution.filePath) {
    const storeOptions: PersistentContextCacheStoreOptions = {
      strict: cacheStrict,
      fallbackMode,
      cleanupFn,
      maxPayloadBytes,
    };
    const persistentStore = new PersistentContextCacheStore(pathResolution.filePath, storeOptions);
    if (fallbackToMemoryOnFailure) {
      try {
        await persistentStore.size();
      } catch (error) {
        recordAuditEvent(
          'context.cache.fallback_to_memory',
          {
            filePath: pathResolution.filePath,
            error: error instanceof Error ? error.message : String(error ?? 'unknown'),
          },
          { source: 'context.cache', severity: 'medium', scope: 'repo', phase: 'CONTEXT' },
        );
        return {
          store: new MemoryContextCacheStore(),
          maxEntries,
          ttlMs,
        };
      }
    }

    return {
      store: persistentStore,
      maxEntries,
      ttlMs,
    };
  }

  return { store: new MemoryContextCacheStore(), maxEntries, ttlMs };
}
