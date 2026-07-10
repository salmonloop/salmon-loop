## 2024-03-24 - Chunking I/O Operations in ArtifactStore
**Learning:** Sequential await loops for `fs.stat` and `fs.rm` across massive file sets (e.g. temporary artifact folders) cause severe event loop blocking and performance issues. While it avoids EMFILE errors compared to unconstrained `Promise.all`, it's incredibly slow.
**Action:** Use chunked batched `Promise.all` mapping (e.g. chunk size 10) for high-volume file operations across the codebase to perfectly balance concurrency speedups without hitting system EMFILE limits.
