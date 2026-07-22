## 2026-07-22 - Fix Timing Attack Vulnerability in Token Comparison
**Vulnerability:** Checking buffer lengths before calling `crypto.timingSafeEqual` creates a short-circuit fast path that leaks the secret's length via timing differences.
**Learning:** `crypto.timingSafeEqual` throws an error if buffers have different lengths, so checking lengths first seems necessary, but it introduces a timing attack vulnerability.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
