## 2026-07-21 - Optimize ArtifactStore Garbage Collection
**Learning:** Optimizing operations that iterate over large numbers of files (e.g. ArtifactStore.gc) using batched concurrent fs.stat and fs.rm checks (e.g. Promise.all with chunk sizes of 10) prevents severe performance bottlenecks and EMFILE limits.
**Action:** When performing file system operations on a potentially large list of directories/files, batch operations in chunks (e.g., of 10) utilizing Promise.all rather than awaiting them sequentially.
