
## 2026-05-16 - I/O Operations Batching in session cleanup
**Learning:** Sequential I/O operations (like `archiveSession` and `deleteSession`) during batched session cleanup in `ChatSessionManager.performAutoCleanup()` cause significant latency, taking ~1500ms for 500 sessions. However, mapping the entire array to `Promise.all` directly runs the risk of causing `EMFILE` errors due to unbounded concurrency when dealing with files.
**Action:** When performing bulk I/O operations on collections of items (like files or sessions), split the array into chunks (e.g. 10 items) and execute them sequentially chunk-by-chunk using `Promise.all()` over the chunk to ensure safe, scalable, and highly optimized parallel execution.
