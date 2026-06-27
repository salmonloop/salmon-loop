## 2025-02-24 - Batched Concurrent I/O for Large File Iterations
**Learning:** Sequential I/O operations (like `fs.stat` and `fs.rm`) when iterating over large numbers of files (e.g., in `ArtifactStore.gc`) create severe performance bottlenecks and increase execution time linearly.
**Action:** Always use batched concurrent I/O (e.g., `Promise.all` with chunk sizes of 10) for directories with many files to speed up execution and avoid EMFILE limits. Instantiate Promises only within the `Promise.all()` call for the specific chunk to avoid immediate concurrent execution upfront.
