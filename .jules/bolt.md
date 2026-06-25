## 2025-02-14 - Lazy Cache Expiration over Full Scans
**Learning:** Full O(N) scans (like `evictExpiredEntries`) executed on every cache `get()` call introduce massive performance overhead (turning an O(1) cache lookup into O(N)). This creates an O(M*N) bottleneck.
**Action:** Always prefer lazy cache expiration combined with insertion-time LRU eviction. Since the specific requested entry is validated for expiration after retrieval, and background LRU handles size bounds, the aggressive full-scan is redundant.
