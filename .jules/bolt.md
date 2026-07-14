## 2024-10-18 - Optimized ArtifactStore.gc loops
**Learning:** Sequential fs.stat and fs.rm calls in high-volume directory loops cause extreme performance bottlenecks and are vulnerable to EMFILE errors when scaling.
**Action:** When working on file operations across large numbers of items (like ArtifactStore.gc), always batch fs.stat and fs.rm checks into concurrent Promise.all arrays with a safe chunk size (e.g. 10) to optimize I/O wait times safely without hitting EMFILE limits. Queue deletions explicitly before executing them to avoid race conditions with size recalculations.
