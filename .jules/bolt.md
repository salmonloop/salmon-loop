## 2024-05-24 - Batched `fs.stat` optimization
**Learning:** Sequential `fs.stat` calls over many files (e.g. cache tracking files) is a codebase-specific performance bottleneck. Using `Promise.all` batched concurrency speeds up operations significantly.
**Action:** Use chunked `Promise.all` arrays (e.g., chunk size 10) instead of sequential `await` loops for multiple independent I/O checks.
