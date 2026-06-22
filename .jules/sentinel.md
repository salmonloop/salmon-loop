## 2024-05-24 - Timing Attack via Buffer Length Check before timingSafeEqual
**Vulnerability:** The authentication check for Bearer tokens compared buffer lengths before calling `crypto.timingSafeEqual`.
**Learning:** Checking buffer length before `timingSafeEqual` creates a short-circuit fast path that leaks the secret's length via timing differences.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.