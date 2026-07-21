## 2026-07-21 - Timing Attack in Bearer Token Validation
**Vulnerability:** Bearer tokens were compared by first checking their buffer lengths (`tokenBuffer.length === authTokenBuffer.length`) before calling `crypto.timingSafeEqual`. This creates a short-circuit fast path that leaks the secret's length via timing differences.
**Learning:** Developers attempted to use constant-time comparison but negated its benefits by adding a length check, which is a common but dangerous anti-pattern.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation, avoiding the need for length checks entirely.
