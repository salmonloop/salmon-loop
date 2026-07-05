## 2026-07-05 - Replace Symbolic Navigation Hints with Screen-Reader Friendly Text
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce purely symbolic text (e.g., `↑↓`, `⏎`) properly, causing an accessibility regression for CLI navigation hints.
**Action:** Always replace purely symbolic navigation hints with visually concise but screen-reader-friendly text (like 'Up/Down', 'Enter') in Ink UI components.
