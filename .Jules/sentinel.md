## 2026-08-31 - Add explicit sensitive key redaction in sanitizeObject
**Vulnerability:** The `sanitizeObject` utility redacted entire `headers` or `request` objects but failed to redact specific sensitive keys (like `authorization`, `password`, or `token`) if they were logged independently or at the top level of an object structure.
**Learning:** Hardcoded blacklists must account for individual sensitive fields, not just container objects, to prevent partial credential leaks in unstructured logs.
**Prevention:** Expanded the blacklist in `sanitizeObject` to include common sensitive keywords (`authorization`, `password`, `token`, etc.) and implemented case-insensitive matching (`toLowerCase()`) to catch variants.
