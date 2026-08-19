## YYYY-MM-DD - Batch Concurrent File Operations for GC
**Learning:** Optimizations of operations that iterate over large numbers of files depend on building a safe removal queue first sequentially, before actual file deletions are executed concurrently in chunks to prevent race conditions during state calculation and avoid EMFILE limits.
**Action:** Always evaluate files sequentially to build a safe removal queue when tracking state like cumulative file size, and then perform file system removals in a batched `Promise.all` with a safe chunk size.
