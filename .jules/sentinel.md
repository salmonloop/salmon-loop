## 2024-07-19 - Timing Attack in Secret Comparison
**Vulnerability:** Fast-path buffer length check before `crypto.timingSafeEqual` in authentication token validation leaks secret length via timing differences.
**Learning:** Checking buffer length before `timingSafeEqual` creates a short-circuit fast path that undermines the constant-time guarantee.
**Prevention:** Always hash both secrets (e.g., using `crypto.createHash('sha256')`) to a fixed length before comparison to ensure true constant-time evaluation.
