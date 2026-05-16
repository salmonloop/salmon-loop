
## $(date +%Y-%m-%d) - Batched Promise.all in ChatSessionManager
**Learning:** Sequential `await` in loops for file I/O causes significant delays. Using `Promise.all` can parallelize reads but unbounded concurrency can cause `EMFILE` errors.
**Action:** When loading multiple files (like in `ChatSessionManager.listSessions` and `ChatSessionManager.loadAllSessions`), use batched `Promise.all` with a chunk size (e.g., 10) to significantly speed up file reading while avoiding file descriptor exhaustion.
