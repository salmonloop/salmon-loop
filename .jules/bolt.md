## 2024-03-24 - ArtifactStore GC batching
**Learning:** In operations that iterate over large numbers of files like `ArtifactStore.gc`, running `fs.stat` sequentially in a single loop creates a massive performance bottleneck.
**Action:** When working with many files, use `Promise.all` with a concurrency limit (chunking) for `fs.stat` and `fs.rm` to optimize operations and avoid EMFILE errors.
