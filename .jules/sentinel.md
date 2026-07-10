## 2025-02-28 - [Timing Attack in A2A Token Validation]
**Vulnerability:** The token comparison in A2A server authentication (serve command) checked lengths before calling `crypto.timingSafeEqual` (`tokenBuffer.length === authTokenBuffer.length`).
**Learning:** Checking buffer lengths first creates a short-circuit fast path that leaks the secret's exact length via timing differences. Once the length is known, it reduces the complexity of brute-forcing the token.
**Prevention:** Always hash secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation across the entire check.
