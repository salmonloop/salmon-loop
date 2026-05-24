## 2024-05-24 - Fix Auth Token Timing Attack
**Vulnerability:** A2A server bearer tokens were validated using `Array.prototype.includes()`, which relies on early-exit string comparisons (`===`). This exposed the server to timing attacks where an attacker could theoretically guess the token character by character.
**Learning:** Even simple array inclusion checks for secrets can introduce timing vulnerabilities in Express middleware.
**Prevention:** Always use `crypto.timingSafeEqual` to compare buffers of equal length when validating authentication secrets.