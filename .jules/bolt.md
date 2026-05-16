
## 2024-05-18 - Optimize File Reading Concurrency
**Learning:** Sequentially awaiting file reads inside loops (e.g. `RejectionManager`) causes substantial I/O bottlenecks and prevents max performance when dealing with large numbers of rejection files.
**Action:** Use chunked `Promise.all` with a chunk size of 10 to fetch file contents concurrently. This speeds up I/O significantly while avoiding `EMFILE` limits that can occur with unbounded concurrency.
