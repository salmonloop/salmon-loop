## 2024-05-24 - O(N^2) Cache Eviction Anti-Pattern
**Learning:** Using `while(size > max) { entries() }` to find the oldest item causes O(N^2) time complexity because `entries()` is repeatedly invoked for every single victim, which is highly inefficient for large cache structures like `ContextService`.
**Action:** When performing LRU eviction manually, fetch entries once, use `Array.from()` to resolve iterables safely, sort by timestamp ascending (O(N log N)), and then linearly iterate to slice/delete the required number of oldest items.

## 2024-05-24 - Over-Optimization of O(N log N) Sort for LRU Eviction
**Learning:** While sorting the entire cache with `entries.sort()` (O(N log N)) is much faster than an O(N^2) loop for evicting multiple items, it creates unnecessary overhead (allocating an array + full sort) for the most common case: evicting exactly *one* item upon insert.
**Action:** When optimizing batch evictions, always include a fast-path for single-item eviction using a simple O(N) linear scan, falling back to the O(N log N) sort only for mass evictions (where `size - max > 1`).
