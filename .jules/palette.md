## 2024-06-17 - Improve Screen Reader Accessibility for CLI Navigation Hints
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce purely symbolic navigation hints (like `↑↓` or `⏎`) properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text for complex command-line selection interfaces or overlays using Ink (e.g., 'Up/Down' instead of '↑↓', 'Enter' instead of '⏎').
