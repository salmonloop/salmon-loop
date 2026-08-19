## 2025-02-12 - Batched I/O for GC performance
**Learning:** Concurrent array mutation inside Promise.all chunking produces non-deterministic order, causing subtle bugs in artifact GC which relies on predictable sorting.
**Action:** Always map Promise.all results and iterate sequentially to apply mutations or maintain order.
