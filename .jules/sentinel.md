## 2025-02-14 - Fix Timing Attack in Authentication
**Vulnerability:** Fast-path short-circuiting in token validation using buffer length comparisons before calling `crypto.timingSafeEqual` introduces a timing attack vulnerability.
**Learning:** Evaluating the lengths of tokens before performing a constant-time comparison leaks the length of the secret auth token.
**Prevention:** Always hash both the expected and provided secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation regardless of input length.
