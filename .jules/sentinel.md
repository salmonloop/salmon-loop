## 2026-07-23 - Timing Attack Vulnerability in Token Validation
**Vulnerability:** Short-circuiting token validation by checking length before `crypto.timingSafeEqual` leaks the secret's length.
**Learning:** Simple string length comparisons and buffer conversions create a fast path that leaks secret lengths via timing differences, undermining the constant-time evaluation of `timingSafeEqual`.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
