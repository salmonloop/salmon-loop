## 2024-05-23 - ContextService LRU and Expiration Batching
**Learning:** O(M*N) overhead and unbounded concurrency EMFILE errors observed in cache eviction and expiration code due to `await this.cacheStore.entries()` in loops and sequential `delete` calls.
**Action:** Optimize by fetching `entries` once via `Array.from()`, using O(N) linear scan for single-item LRU evictions instead of O(N log N) sorting, and batching deletions in chunk sizes of 10 with `Promise.all()` to significantly reduce overhead and prevent EMFILE errors.
