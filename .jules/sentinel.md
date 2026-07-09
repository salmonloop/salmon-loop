## 2024-05-24 - Timing attack in token validation
**Vulnerability:** Token validation code checked token lengths before calling `crypto.timingSafeEqual`, short-circuiting and leaking the expected token's length via timing differences.
**Learning:** Checking buffer lengths before a constant-time comparison creates a fast path that exposes secret length information.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
