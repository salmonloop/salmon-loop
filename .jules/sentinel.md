## 2024-05-28 - Timing Attack Vulnerability in Token Validation
**Vulnerability:** The Bearer token validation in `src/cli/commands/serve.ts` used `Array.prototype.includes`, which relies on standard string comparison, introducing a timing attack vulnerability.
**Learning:** Simple string comparisons for secrets can leak information about the secret length and content based on execution time.
**Prevention:** Use `crypto.timingSafeEqual` for all secret comparisons, ensuring buffers are padded or strictly checked for equal length before comparison.
