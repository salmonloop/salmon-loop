## 2024-05-30 - [Optimize I/O batching]
**Learning:** Sequential await or unchecked concurrency inside loops like `Promise.all(files.map(...))` without chunking leads to EMFILE (Too many open files) and limits the performance drastically with many active blobs on disk
**Action:** Use chunk-based batched `Promise.all` logic inside these routines. Ensure chunking utility is used.
