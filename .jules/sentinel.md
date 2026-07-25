## 2026-07-25 - Fix timing attack in token validation
**Vulnerability:** The authentication token validation in `serve.ts` checked the token length before calling `crypto.timingSafeEqual`. This short-circuit fast path leaked the secret's length via timing differences, rendering the validation vulnerable to timing attacks.
**Learning:** Checking lengths before calling constant-time comparison functions introduces a vulnerability. When validating secrets, even length checks should be avoided if they leak information.
**Prevention:** Always hash both secrets to a fixed length (e.g., using `crypto.createHash('sha256')`) before comparison to ensure true constant-time evaluation and avoid leaking the length.
