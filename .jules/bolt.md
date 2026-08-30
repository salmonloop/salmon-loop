## 2026-08-30 - Pre-computed array lookups for bounded data
**Learning:** For high-throughput render paths in React `ink` terminal UIs, pre-computed array lookups for bounded data (like time formatting 0-59) reduce performance overhead compared to repeated string allocations (like `String().padStart()`).
**Action:** Use pre-computed arrays for repetitive simple transformations in high-frequency rendering components.
