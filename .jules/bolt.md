## 2026-08-29 - Pre-computed Array Lookups for `ink` Terminal UIs
**Learning:** In high-throughput React `ink` terminal UI render paths, repeated string allocations like `String().padStart()` create significant overhead.
**Action:** Prefer pre-computed array lookups for bounded data (like time formatting 0-59) to drastically reduce performance overhead.
