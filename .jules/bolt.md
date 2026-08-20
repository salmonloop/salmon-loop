## 2026-08-20 - Replaced regex lookbehind with indexOf in eol.ts
**Learning:** Using negative lookbehind regex `/(?<!\r)\n/g` to count line endings is extremely slow on large files compared to a simple `indexOf` loop, causing >15x performance degradation
**Action:** Use `indexOf` or a similar string parsing approach instead of negative lookbehinds when processing potentially large strings
