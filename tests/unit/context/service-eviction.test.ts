import { describe, expect, it, beforeEach } from 'bun:test';

import { MemoryContextCacheStore } from '../../../src/core/context/cache/store.js';
import { ContextService } from '../../../src/core/context/service.js';

describe('ContextService Eviction', () => {
  let cacheStore: MemoryContextCacheStore;
  let service: ContextService;

  beforeEach(() => {
    cacheStore = new MemoryContextCacheStore();
    service = new ContextService({}, { cacheStore, cacheMaxEntries: 3, cacheTtlMs: 1000 });
  });

  it('evicts exactly the oldest entries when overage > 1', async () => {
    // Add 5 entries (max is 3)
    await cacheStore.set('key1', { intentSignature: '1', result: {} as any, signature: '1', trackedFiles: [], createdAt: 100, lastAccessedAt: 100 });
    await cacheStore.set('key2', { intentSignature: '2', result: {} as any, signature: '2', trackedFiles: [], createdAt: 200, lastAccessedAt: 200 });
    await cacheStore.set('key3', { intentSignature: '3', result: {} as any, signature: '3', trackedFiles: [], createdAt: 300, lastAccessedAt: 300 });
    await cacheStore.set('key4', { intentSignature: '4', result: {} as any, signature: '4', trackedFiles: [], createdAt: 400, lastAccessedAt: 400 });
    await cacheStore.set('key5', { intentSignature: '5', result: {} as any, signature: '5', trackedFiles: [], createdAt: 500, lastAccessedAt: 500 });

    // We expect 5 total entries right now.
    expect(await cacheStore.size()).toBe(5);

    // Call the private method via any
    await (service as any).evictLruIfNeeded();

    // Should have evicted exactly 2
    expect(await cacheStore.size()).toBe(3);

    // It should have evicted the oldest ones: key1 and key2
    const entries = await cacheStore.entries();
    const remainingKeys = entries.map(([key]) => key).sort();
    expect(remainingKeys).toEqual(['key3', 'key4', 'key5']);

    // Check cacheMetrics
    expect((service as any).cacheMetrics.evictions).toBe(2);
  });
});
