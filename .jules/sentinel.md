## 2025-05-15 - Timing Attack Vulnerability in Token Validation
**Vulnerability:** The Bearer token validation in `serve.ts` compared buffer lengths before using `crypto.timingSafeEqual`, which creates a short-circuit fast path that leaks the secret token's length via timing differences.
**Learning:** Checking buffer lengths explicitly bypasses the constant-time guarantee of `crypto.timingSafeEqual` when the lengths differ, exposing the secret's length.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation, without checking lengths first.
