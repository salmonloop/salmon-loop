## 2025-01-20 - Fix timing attack vulnerability in Bearer token validation
**Vulnerability:** Bearer tokens were compared using `crypto.timingSafeEqual`, but preceded by a `buffer.length` check that created a fast path, making the validation vulnerable to length-leaking timing attacks.
**Learning:** Checking lengths before `timingSafeEqual` nullifies its protection against timing attacks for secrets of unequal lengths.
**Prevention:** Hash both secrets to a fixed length (e.g., via SHA-256) prior to comparison to guarantee a constant-time check regardless of input lengths.
