## 2024-06-19 - ContextService Tracked Files Signature Optimization
**Learning:** Sequential file `stat` operations in caching paths like `ContextService.computeTrackedFilesSignature` cause unnecessary performance bottlenecks (scaling linearly with `MAX_CACHE_TRACKED_FILES` up to 64 files).
**Action:** Use batched concurrent checks (e.g., `Promise.all` with chunking) for multiple independent file system I/O operations to improve performance.
