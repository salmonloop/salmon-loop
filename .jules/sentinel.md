## 2025-05-14 - Timing Attack in Token Validation
**Vulnerability:** A timing attack vulnerability was found in `src/cli/commands/serve.ts` where the lengths of `tokenBuffer` and `authTokenBuffer` were compared before calling `crypto.timingSafeEqual`.
**Learning:** Comparing lengths before `crypto.timingSafeEqual` creates a short-circuit fast path. An attacker can guess the length of the expected token because invalid lengths return faster than valid ones.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation and prevent leaking the secret's length via timing differences.
