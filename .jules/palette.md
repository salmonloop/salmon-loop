## 2024-05-30 - Replace Navigation Symbols with Screen-Reader Friendly Text
**Learning:** For complex command-line selection interfaces or overlays using Ink, screen readers in CLI environments rely on raw text output and fail to announce purely symbolic text (like `↑↓`, `⏎`) properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text (like 'Up/Down', 'Enter') instead of symbols for keyboard navigation hints to ensure accessibility for visually impaired users.
