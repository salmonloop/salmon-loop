## YYYY-MM-DD - Fix authentication timing attack vulnerability
**Vulnerability:** A length check (`tokenBuffer.length === authTokenBuffer.length`) was performed before calling `crypto.timingSafeEqual`, which creates a short-circuit fast path that leaks the secret's length via timing differences.
**Learning:** Checking buffer lengths before a constant-time comparison defeats the purpose of constant-time evaluation because attackers can guess the length based on response times.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation, instead of relying on `Buffer.from` and length checks.
