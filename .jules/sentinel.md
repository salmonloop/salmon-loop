## 2025-05-27 - Implement timing-safe token validation
**Vulnerability:** A timing attack vulnerability existed where bearer tokens were compared using `!authTokens.includes(token)`, allowing an attacker to determine token lengths and characters through timing discrepancies.
**Learning:** Simple string comparisons or array methods like `includes` are not secure for sensitive credentials as they return false early and vary in execution time based on matching characters.
**Prevention:** Always use `crypto.timingSafeEqual` with buffer length validation to securely compare tokens or passwords, preventing timing attacks.
