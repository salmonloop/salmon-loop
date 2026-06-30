## 2026-06-30 - Prevent Timing Attacks in Token Validation
**Vulnerability:** Length checks before `crypto.timingSafeEqual` create a short-circuit fast path that leaks the secret's length via timing differences.
**Learning:** Checking buffer lengths (`tokenBuffer.length === authTokenBuffer.length`) before calling `crypto.timingSafeEqual` defeats the purpose of constant-time evaluation.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
