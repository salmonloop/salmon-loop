## 2025-02-12 - Optimize ContextService cache evictions

**Learning:** In `ContextService` and similar cache managers, repeatedly calling `this.cacheStore.entries()` inside loops (like `while` loops or nested array maps) causes `O(M * N)` time complexity bottlenecks.
**Action:** Always fetch it once using `Array.from()` to safely consume the iterable and avoid mutating internal cache store references during operations like `.sort()`. To optimize further, use an O(N) linear scan for single-item evictions to avoid overhead, reserving O(N log N) sorting only for mass batch evictions. Also batch asynchronous deletions with `Promise.all` in chunks (e.g. 10) to avoid EMFILE/I/O contention.
