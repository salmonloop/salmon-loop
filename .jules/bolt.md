## 2024-07-11 - Optimize Auto-Cleanup Find Lookup
**Learning:** In `ChatSessionManager.performAutoCleanup`, searching through a global array of sessions via `Array.prototype.find` inside a loop over chunks created an $O(N \times M)$ bottleneck when deleting/archiving sessions.
**Action:** When filtering or locating items inside batched or chunked map loops, pre-compute a `Map` structure for $O(1)$ lookups to bring the complexity down to $O(N + M)$, avoiding excessive CPU blocking in potentially high-volume tasks.
