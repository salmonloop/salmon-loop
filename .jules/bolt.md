## 2026-09-01 - Pre-computing bounded data in high-throughput render paths
**Learning:** In React `ink` terminal UIs, repeated string allocations for bounded data (like time formatting 0-59 using `String().padStart()`) add measurable overhead on every render.
**Action:** Prefer pre-computed array lookups for bounded data like minutes and seconds to reduce CPU overhead during rendering.
