## 2024-03-20 - Promise.all Batching
**Learning:** Sequential `.map(async () => ...)` inside `Promise.all` can cause EMFILE (too many open files) errors or memory exhaustion when dealing with a large number of files.
**Action:** Use a batching utility (e.g., chunking the array) when dealing with I/O operations across many files to prevent resource exhaustion.
