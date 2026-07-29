## 2026-07-29 - Prevent Length Leakage in Timing-Safe Comparisons
**Vulnerability:** Length leakage in authentication token comparison.
**Learning:** Comparing token lengths before `crypto.timingSafeEqual` leaks the exact length of the secret token to an attacker through timing differences.
**Prevention:** Always hash the tokens (e.g., using SHA-256) before comparing them, since hashes have a fixed length, avoiding length comparison timing side-channels.