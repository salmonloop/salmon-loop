## 2025-02-18 - Optimize fs.rm loops in Worktree Cleanup
**Learning:** Sequential `await rm()` calls on numerous large dependency directories (e.g., node_modules) inside a for-loop significantly bottleneck teardown times, especially for isolated parity worktrees. Unbounded `Promise.all()` arrays can cause `EMFILE` exceptions.
**Action:** Use chunked `Promise.all()` arrays (chunk size of 10) to execute `fs.rm()` concurrently, which improved simulated dependency cleanup times by approximately 4x (from ~81ms to ~20ms for 200 items).
