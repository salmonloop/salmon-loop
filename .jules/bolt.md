## 2026-04-29 - [Found Context Cache Bottleneck]
**Learning:** Sequential await inside a for..of loop in cache evictions and key generation causes unnecessary synchronous blocking of the main thread when many entries or files are involved.
**Action:** Replace sequential `for (const item of await iterable)` with `processInBatches` or concurrent `Promise.all(Array.from(iterable).map(...))` batching for better async throughput in ContextService.
