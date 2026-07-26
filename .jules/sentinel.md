## YYYY-MM-DD - Fix timing attack vulnerability in token validation
**Vulnerability:** A timing attack vulnerability in `src/cli/commands/serve.ts` where token lengths are checked before `crypto.timingSafeEqual`, leaking the secret's length.
**Learning:** Checking buffer lengths before calling `timingSafeEqual` creates a short-circuit fast path that leaks the secret's length via timing differences. Simple string comparisons or fast-path length checks should not be used for secrets.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation.
