## 2024-05-04 - Optimize `evictLruIfNeeded` cache entry eviction loop
**Learning:** `this.cacheStore.entries()` was repeatedly called inside a `while` loop to linearly scan for the oldest entry one by one. This causes `O(K * N)` time complexity and multiple async iterator creations.
**Action:** Replace the loop with a single `entries` fetch, sort the array by timestamp (`O(N log N)`), and then slice or iteratively delete the `excess` amount.
