## 2024-07-21 - Fix timing attack vulnerability in token validation
**Vulnerability:** The Bearer token validation used a length check (`tokenBuffer.length === authTokenBuffer.length`) before calling `crypto.timingSafeEqual`. This short-circuit fast path leaked the length of valid tokens via timing differences.
**Learning:** `crypto.timingSafeEqual` requires buffers of equal length. Checking length first defeats the purpose of a constant-time comparison because an attacker can brute-force the length.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation, regardless of the input lengths.
