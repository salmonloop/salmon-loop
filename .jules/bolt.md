## 2024-03-24 - File IO Optimization
**Learning:** Sequential `fs.stat` and `fs.rm` operations in garbage collection routines for large number of files can cause serious performance bottlenecks.
**Action:** Use batched concurrent chunking with `Promise.all` for both stat and delete operations to avoid race conditions during calculation and speed up the GC phase without hitting `EMFILE` limits.
