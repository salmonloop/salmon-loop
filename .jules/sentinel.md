## 2026-07-24 - Timing Attack Vulnerability in Token Comparison
**Vulnerability:** The Bearer token validation in `serve.ts` checked `tokenBuffer.length === authTokenBuffer.length` before calling `crypto.timingSafeEqual`.
**Learning:** Checking the length of a secret before a constant-time comparison creates a short-circuit fast path. This leaks the secret's length via timing differences, rendering the `timingSafeEqual` ineffective against attackers trying to guess the token length.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation regardless of the input lengths.
