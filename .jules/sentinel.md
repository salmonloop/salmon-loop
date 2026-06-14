## 2026-06-14 - Fix Timing Attack in Token Validation
**Vulnerability:** A timing attack vulnerability existed in the Bearer token validation logic. The code checked if the lengths of the user-provided token and the expected token were equal before using `crypto.timingSafeEqual`.
**Learning:** Checking buffer lengths before a constant-time comparison creates a short-circuit fast path. An attacker can guess the length of a secret based on whether the request returns quickly (length mismatch) or takes slightly longer (length match and entering `timingSafeEqual`).
**Prevention:** Always hash secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison. This ensures both buffers are the same length and avoids short-circuiting, allowing true constant-time evaluation.
