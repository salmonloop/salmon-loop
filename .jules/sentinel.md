## 2024-06-19 - [Timing attack vulnerability in token validation]
**Vulnerability:** A length check before `crypto.timingSafeEqual` leaked the token length.
**Learning:** Checking the length of a token buffer before calling `crypto.timingSafeEqual` introduces a short-circuit fast path that leaks the secret's length via timing differences.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
