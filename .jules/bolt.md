## 2023-11-20 - Cache Eviction Sort Implementation
**Learning:** Calling `await this.cacheStore.entries()` repeatedly within a `while` loop, as observed in cache eviction implementations (`evictLruIfNeeded`), evaluates to an `O(M * N)` time complexity scaling where M is overage elements and N is cache entry size.
**Action:** When working on array-like maps and performing bulk eviction based on conditions like LRU (timestamp comparison), always resolve the iterator once up-front, sort by criteria using an `O(N log N)` sort algorithm (`Array.prototype.sort()`), and process linearly in `O(M)`.
