## 2024-05-24 - Timing Attack via Length Check Fast Path
**Vulnerability:** A length check before calling `crypto.timingSafeEqual` for variable-length secrets (like A2A tokens) created a short-circuit fast path, leaking the length of the secret via timing differences.
**Learning:** `crypto.timingSafeEqual` throws if buffer lengths do not match, tempting developers to check length first. However, doing so destroys the constant-time guarantee because different lengths return immediately.
**Prevention:** Always hash both the user input and the expected secret using a cryptographic hash function (e.g., SHA-256) to ensure they are the exact same fixed length before calling `timingSafeEqual`.
