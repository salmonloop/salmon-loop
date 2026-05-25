## 2024-05-25 - Timing Attack Vulnerability in Token Validation
**Vulnerability:** A timing attack vulnerability was identified in the authentication middleware, where simple array inclusion (`!authTokens.includes(token)`) was used to validate bearer tokens.
**Learning:** Using simple string comparison or array inclusion for token validation exposes the application to timing attacks, as the comparison duration depends on whether parts of the token match.
**Prevention:** Always use `crypto.timingSafeEqual` to compare buffers of equal length when validating authentication tokens or passwords.