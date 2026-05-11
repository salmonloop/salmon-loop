## 2026-05-11 - Context Cache LRU Eviction Optimization
**Learning:** Calling `this.cacheStore.entries()` inside a `while` loop for LRU eviction caused an O(M * N) complexity overhead, creating a bottleneck during mass evictions.
**Action:** Replace the loop with a single `entries` fetch, utilizing an O(N) linear scan for single-item evictions and O(N log N) sorting for batch evictions.
