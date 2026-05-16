## 2024-05-16 - ContextService LRU Cache Eviction Optimization
**Learning:** `evictLruIfNeeded` repeatedly fetched `this.cacheStore.entries()` inside a while loop, resulting in O(M * N) complexity when evicting multiple items. Additionally, concurrent deletions lacked batching which could lead to EMFILE errors or heavy I/O contention.
**Action:** Always fetch `entries()` once before the loop. Calculate the required excess, use an O(N) scan for single evictions, and an O(N log N) sort for batch evictions. Delete items using a chunked `Promise.all` approach to manage concurrency limits.
