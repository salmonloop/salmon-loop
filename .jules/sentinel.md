## 2025-02-12 - Fix Timing Attack Vulnerability in Bearer Token Validation
**Vulnerability:** A timing attack vulnerability existed where short-circuiting on buffer length differences in `crypto.timingSafeEqual` leaked the length of the secret.
**Learning:** Developers might check buffer lengths before `timingSafeEqual` because `timingSafeEqual` throws an error on unequal lengths. However, this re-introduces a timing leak (length).
**Prevention:** Always hash both inputs to a fixed-length digest (e.g. SHA-256) before using `crypto.timingSafeEqual`.
