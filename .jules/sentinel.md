## 2024-05-15 - Timing Attack Vulnerability in Bearer Token Validation
**Vulnerability:** Bearer tokens were being validated using simple string comparison (`Array.prototype.includes`), which introduces timing attack vulnerabilities.
**Learning:** String comparisons terminate early on mismatches, allowing an attacker to deduce the correct token length and content by measuring response times.
**Prevention:** Use `crypto.timingSafeEqual` to compare tokens in constant time, ensuring buffers are padded or lengths are checked before comparison.
