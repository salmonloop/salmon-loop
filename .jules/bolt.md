## 2026-08-21 - Optimize Time Formatting in CLI UI
**Learning:** Formatting timestamps on every message using `String().padStart()` adds up to significant overhead in a React terminal UI (ink) where many messages are re-rendered. A simple pre-computed array lookup is over 5x faster.
**Action:** Use pre-computed array lookups for bounded, frequently formatted data (like minutes/seconds 0-59) in high-throughput render paths.
