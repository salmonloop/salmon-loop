## 2025-06-09 - Token Length Leak via Short-Circuit Timing
**Vulnerability:** The authentication token comparison in `serve.ts` used `tokenBuffer.length === authTokenBuffer.length && crypto.timingSafeEqual(...)`. This short-circuited evaluation leaked whether the submitted token matched the expected token's length through timing differences.
**Learning:** Applying `crypto.timingSafeEqual` natively requires buffers of equal length. Checking lengths first defeats the constant-time guarantee by creating a fast path for incorrect lengths.
**Prevention:** Always hash secrets to a fixed length (e.g., SHA-256) before using `crypto.timingSafeEqual`, which ensures the buffers are always the same size and eliminates the length-leak branch.
