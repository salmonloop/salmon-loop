## 2025-02-28 - Batch concurrent fs operations to avoid EMFILE limits
**Learning:** When iterating over a large number of files in `ArtifactStore.gc`, sequential `fs.stat` and `fs.rm` checks create performance bottlenecks and sequential loops. Although fully parallelizing could cause EMFILE errors, batched concurrent execution solves both performance and limit issues.
**Action:** Use chunked batched `Promise.all` requests with a chunk size of 10 for mass `fs.stat` and `fs.rm` operations.
