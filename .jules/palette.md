## 2024-07-06 - CLI Symbol Screen Reader Accessibility
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce purely symbolic text (e.g., `↑↓`, `⏎`) properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text (e.g., 'Up/Down', 'Enter') for navigation hints instead of pure symbols to ensure accessibility.
