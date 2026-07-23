## 2026-07-23 - Screen reader friendly keyboard navigation hints
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce purely symbolic navigation text (like `↑↓`, `⏎`) properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly descriptive text (like 'Up/Down', 'Enter') instead of symbols for keyboard navigation hints in Ink UI components.
