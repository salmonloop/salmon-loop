## 2024-06-23 - ArtifactStore GC Batched stat checks
**Learning:** In ArtifactStore.gc, using sequential `await fs.stat` in a loop across thousands of files causes significant performance degradation.
**Action:** Use batched concurrent `Promise.all` mapping over the array in chunk sizes of 10 to speed up directory traversal for cleanup.
