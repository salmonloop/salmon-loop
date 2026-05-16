## 2024-05-16 - ⚡ Bolt: Batched Context Cache Eviction

**Learning:** `evictLruIfNeeded` repeatedly fetched `await this.cacheStore.entries()` inside a while-loop (O(N^2) complexity), dominating cache invalidation time. Similarly, `evictExpiredEntries` evaluated expiry sequentially, failing to utilize I/O overlap.
**Action:** Replace while-loop scanning with a single read, array sort (O(N log N)), and slice eviction in LRU logic. Batch asynchronous expirations with `Promise.all` with chunking to prevent maxing out concurrency while drastically improving throughput.
