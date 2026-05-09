
## 2026-05-09 - ⚡ Bolt: [performance improvement] batch file synchronization
**Learning:** Sequential disk and process operations in tight loops (like `applyExplicitMerge` resolving shadow diffs) significantly throttle processing throughput for massive repository payloads. Processing files iteratively leads to high overall execution times linearly scaling with change size.
**Action:** When iterating over arrays executing independent system or file I/O operations, use bounded parallelism via `processInBatches` to process chunks concurrently. This maximizes hardware throughput and CPU utilization without exhausting file handles or hitting unmanaged concurrency limits.
