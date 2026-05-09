## 2024-05-09 - [WorkspaceSynchronizer Concurrent lstat Check]
**Learning:** Sequential `for...of` loops awaiting filesystem checks like `lstat()` for many candidate paths cause a significant performance bottleneck (e.g., 216ms vs 23ms for 1000 paths).
**Action:** Use `Promise.all` with `Array.map` to perform I/O bound checks concurrently.
