## 2025-02-09 - Timing Attack Vulnerability in Token Verification
**Vulnerability:** The `authMiddleware` in `src/cli/commands/serve.ts` checked token lengths before calling `crypto.timingSafeEqual`.
**Learning:** Checking buffer lengths before constant-time comparison creates a fast path that leaks the expected secret length via timing differences.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.