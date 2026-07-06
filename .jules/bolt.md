## 2024-06-11 - Optimize ArtifactStore garbage collection performance
**Learning:** Sequential fs.stat and fs.rm operations in large directories (like the artifact store after extended sessions) caused significant Event Loop blocking and O(N) execution time, dramatically slowing down `maybeGc()`.
**Action:** Replaced sequential awaits in `ArtifactStore.gc` loops with concurrent batching (Promise.all) in chunks of 10. Chunked iteration is essential because it avoids opening too many file descriptors (EMFILE) while vastly improving throughput over sequential await.
