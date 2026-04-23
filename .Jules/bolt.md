## 2024-04-23 - Batch Promise Execution
**Learning:** Sequential await loops for multiple file reads are inefficient and can cause unbounded concurrency problems when reading large directories (like session files in ChatSessionManager).
**Action:** When performing file operations inside a loop (especially `readFile` across many files), use `Promise.all` with concurrent execution and chunking to manage concurrent file descriptors, avoiding `EMFILE` and significantly improving load times for list endpoints.
