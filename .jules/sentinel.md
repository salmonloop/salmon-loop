## 2024-05-24 - Length Leakage in timingSafeEqual
**Vulnerability:** Bearer token validation checks `tokenBuffer.length === authTokenBuffer.length` before calling `crypto.timingSafeEqual`, which creates a short-circuit fast path that leaks the secret's length via timing differences.
**Learning:** While `timingSafeEqual` prevents timing attacks on the comparison itself, checking length first defeats the purpose if lengths differ, allowing attackers to guess the token length.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
