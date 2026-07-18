## 2026-07-18 - Avoid symbolic text for keyboard navigation hints
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce purely symbolic text (like `↑↓`, `⏎`) properly, causing an accessibility regression for navigation hints.
**Action:** Use visually concise but screen-reader-friendly text (like 'Up/Down', 'Enter') for descriptive navigation words in Ink UI components.
