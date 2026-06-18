## 2024-06-18 - Screen Reader Accessibility in CLI Navigation
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce purely symbolic text (e.g., `↑↓`, `⏎`) properly, causing an accessibility regression for navigation hints.
**Action:** Use visually concise but screen-reader-friendly descriptive text (e.g., 'Up/Down', 'Enter') for navigation instructions in Ink CLI components instead of unicode symbols.
