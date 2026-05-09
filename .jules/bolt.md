## 2025-02-12 - Prevent Repeated Array Allocation in Cache Eviction
**Learning:** Calling `this.cacheStore.entries()` inside a `while` loop when evicting items causes an O(M * N) bottleneck due to repeated array allocations and iterations, especially when standard cache stores resolve it to a whole Array snapshot.
**Action:** Always fetch the `entries` array once, sort it if necessary, and use a linear pass to remove elements instead of querying inside an eviction loop.
