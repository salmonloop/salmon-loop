## 2025-02-25 - Optimization of ArtifactStore GC file operations
**Learning:** Operations that iterate over large numbers of files sequentially for stats and deletions can lead to EMFILE errors or severe performance bottlenecks.
**Action:** Use Promise.all with batched/chunked processing of `fs.stat` and `fs.rm` calls to safely improve concurrency while limiting the number of open file handles to avoid OS limits. Build the removal queue safely before triggering batch removals.
