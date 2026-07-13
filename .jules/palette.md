## 2024-05-24 - Screen Reader Compatibility for Navigation Hints
**Learning:** For complex command-line selection interfaces or overlays using Ink, replacing descriptive navigation words (like 'Up/Down', 'Enter') with purely symbolic text (e.g., `↑↓`, `⏎`) to save horizontal space causes accessibility regressions. Screen readers in CLI environments rely on raw text output and fail to announce these symbols properly.
**Action:** Always use visually concise but screen-reader-friendly text (e.g., 'Up/Down', 'Enter') for navigation hints instead of special characters or symbols.
