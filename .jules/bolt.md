## 2026-08-20 - Replaced regex lookbehind with indexOf in eol.ts
**Learning:** Using negative lookbehind regex `/(?<!\r)\n/g` to count line endings is extremely slow on large files compared to a simple `indexOf` loop, causing >15x performance degradation
**Action:** Use `indexOf` or a similar string parsing approach instead of negative lookbehinds when processing potentially large strings

## 2026-09-03 - Optimize time formatting in ink UIs
**Learning:** In high-throughput render paths like React `ink` terminal UIs, repeated string allocations (`String().padStart()`) introduce measurable overhead. Pre-computed array lookups for bounded data (like time formatting 0-59) significantly reduce execution time.
**Action:** Prefer pre-computed array lookups for bounded data over repeated string allocations to reduce performance overhead.
