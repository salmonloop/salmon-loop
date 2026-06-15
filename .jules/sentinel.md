## 2024-06-15 - Timing Attack Vulnerability in Bearer Token Validation
**Vulnerability:** A fast-path short-circuit using `tokenBuffer.length === authTokenBuffer.length` prior to `crypto.timingSafeEqual` introduced a timing side-channel attack.
**Learning:** Checking the lengths before calling `timingSafeEqual` breaks constant-time evaluation, allowing an attacker to determine the secret token length via timing differences.
**Prevention:** Always hash secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation regardless of the input length.
