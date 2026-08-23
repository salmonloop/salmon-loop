## 2026-08-23 - Optimizing time formatting in high-throughput render paths
**Learning:** In terminal UIs using React and Ink, formatting timestamps using `String().padStart()` inside the render loop causes significant overhead and unnecessary string allocations, leading to performance degradation in high-throughput message lists.
**Action:** Replace dynamic padding with a pre-computed string array lookup (`Array.from({length: 60})`) for bounded values like hours, minutes, and seconds (0-59).
