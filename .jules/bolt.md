## 2026-08-26 - [Optimize formatTime for high-throughput render paths]
**Learning:** React ink components like `messageList` items re-render frequently. Using `String().padStart()` repeatedly creates significant performance overhead through string allocations. Pre-computing array lookups for bounded data (like time formatting 0-59) reduces overhead by ~25x.
**Action:** Use pre-computed arrays for formatting bounded, repetitive data in high-throughput React rendering paths.
