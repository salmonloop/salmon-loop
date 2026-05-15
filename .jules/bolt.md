## 2025-02-12 - ContextService Cache Eviction Bottleneck
**Learning:** In `ContextService` and similar cache managers, repeatedly calling `await this.cacheStore.entries()` inside a `while` loop for batch eviction results in `O(M * N)` time complexity and extreme I/O overhead.
**Action:** Fetch entries once using `await this.cacheStore.entries()`. For single-item eviction, use an `O(N)` linear scan. For mass batch evictions, use an `O(N log N)` sort, and then perform sequential batch deletion.
