## 2024-05-24 - Fix timing attack vulnerability in Bearer token validation
**Vulnerability:** A length check before calling `crypto.timingSafeEqual` in `src/cli/commands/serve.ts` leaks the expected token's length via timing differences.
**Learning:** Checking buffer lengths before constant-time comparison creates a short-circuit fast path that defeats the purpose of constant-time evaluation.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
