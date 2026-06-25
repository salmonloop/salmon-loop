## 2024-05-30 - Fix timing attack vulnerability in Bearer token validation
**Vulnerability:** The code compared authorization tokens using `crypto.timingSafeEqual`, but preceded it with a buffer length check.
**Learning:** Checking buffer lengths before calling `crypto.timingSafeEqual` creates a short-circuit fast path that leaks the secret's length via timing differences.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
