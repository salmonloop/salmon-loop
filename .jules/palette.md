## 2024-05-24 - Screen Reader Friendly Navigation Hints
**Learning:** For complex command-line selection interfaces or overlays using Ink, screen readers in CLI environments rely on raw text output and fail to announce purely symbolic navigation text (e.g., `↑↓`, `⏎`) properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text (like 'Up/Down', 'Enter') instead of symbols for keyboard navigation hints to ensure accessibility.
