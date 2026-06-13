## YYYY-MM-DD - [Title]
**Vulnerability:** [What you found]
**Learning:** [Why it existed]
**Prevention:** [How to avoid next time]
## 2024-06-18 - Fix timing attack in token length check
**Vulnerability:** The authentication check in `serve.ts` performed a length comparison (`tokenBuffer.length === authTokenBuffer.length`) before calling `crypto.timingSafeEqual`.
**Learning:** This short-circuit evaluation creates a fast path that leaks the secret token's length via timing differences. `crypto.timingSafeEqual` is only constant-time if the lengths match, but returning early on length mismatch defeats the purpose.
**Prevention:** Always hash both the provided and expected secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before calling `crypto.timingSafeEqual` to ensure true constant-time evaluation regardless of the input lengths.
