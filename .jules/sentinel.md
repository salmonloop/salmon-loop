## 2025-02-06 - Timing Attack Vulnerability in Token Comparison
**Vulnerability:** Secret comparison using length checks before timingSafeEqual, which exposes secret length via timing differences.
**Learning:** A length check before crypto.timingSafeEqual creates a fast path that can be timed to determine the secret's length. timingSafeEqual must be called with fixed length buffers.
**Prevention:** Always hash both secrets to a fixed length (e.g. using crypto.createHash('sha256').update(secret).digest()) before comparison to ensure true constant-time evaluation and hide original secret length.
