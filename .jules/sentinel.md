## YYYY-MM-DD - Timing Attack Vulnerability in Token Validation
**Vulnerability:** A length check (`tokenBuffer.length === authTokenBuffer.length`) before `crypto.timingSafeEqual` in `src/cli/commands/serve.ts` created a fast path that leaked the length of valid tokens through timing differences.
**Learning:** Checking buffer lengths prior to constant-time comparisons voids the constant-time guarantee by introducing an early exit.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation regardless of the input lengths.
