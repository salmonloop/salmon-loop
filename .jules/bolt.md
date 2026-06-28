## 2024-05-15 - Batched concurrent I/O operations for large file iterations
**Learning:** Sequential await calls in loops for operations like `fs.stat` or `fs.rm` over large directories (e.g. ArtifactStore.gc) cause severe performance bottlenecks and can trigger EMFILE limits.
**Action:** Always batch I/O operations using `Promise.all` with a reasonable chunk size (e.g. 10) to parallelize without hitting EMFILE limits.
## 2024-05-15 - Array.find inside batched iterations causes O(N^2) regressions
**Learning:** In batched loops, such as when calling `isExpired` inside `evictExpiredEntries`, calling `this.cacheStore.get()` inside the loop performs an O(N) lookup. Since the loop runs O(N) times, the overall complexity becomes O(N^2), causing performance regressions.
**Action:** Always reuse the entry objects obtained during the initial O(N) iteration rather than fetching them again.
