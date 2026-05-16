## 2025-05-16 - Optimize sidecar-layer injection with chunked Promise.all
**Learning:** Sequential disk writes inside a `for...of` loop can become a significant bottleneck when processing thousands of files. Unbounded `Promise.all` can cause `EMFILE` errors, but using sequential execution is too slow.
**Action:** When performing batched filesystem or network operations, use chunked concurrent execution with `Promise.all` (e.g., chunk size of 10) instead of sequential `await` loops. This strikes the right balance between high throughput and safe file descriptor limits.
