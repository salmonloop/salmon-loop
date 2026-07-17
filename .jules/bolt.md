## 2024-07-17 - Optimize I/O batching across files
**Learning:** Optimizing file operations across many files requires batching concurrent `fs.stat` and `fs.rm` (e.g., `Promise.all` with chunk size of 10) to avoid EMFILE limits, while state-dependent operations (like calculating cumulative totals) must build their removal queue sequentially before concurrent execution.
**Action:** When refactoring sequential file system operations into batched concurrent promises, always separate state calculation into a sequential pass and restrict batched promises to pure I/O effects.
