## 2026-08-22 - [Time Formatting Array Lookups]
**Learning:** For high-throughput render paths in React `ink` terminal UIs, prefer pre-computed array lookups for bounded data (like time formatting 0-59) over repeated string allocations (like `String().padStart()`) to reduce performance overhead.
**Action:** When implementing rendering logic that formats small ranges of numbers, utilize pre-computed lookup tables to minimize string allocations.
