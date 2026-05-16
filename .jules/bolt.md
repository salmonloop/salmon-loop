## 2026-05-16 - Batch Promise Execution for Disk I/O Stores
**Learning:** Performing a naive sequential `await` on functions that eventually trigger disk I/O (like `cacheStore.delete()`) results in massive overhead. Replacing it with unbounded `Promise.all` runs into OS `EMFILE` limits.
**Action:** Always process operations that trigger disk I/O in fixed-size concurrency chunks (e.g., `chunkSize = 10`) when iterating over maps or cache stores, ensuring safe parallel execution without resource exhaustion.
