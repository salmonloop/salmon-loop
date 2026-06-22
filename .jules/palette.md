## 2024-06-22 - Screen Reader Friendly Navigation Hints
**Learning:** For complex command-line selection interfaces or overlays using Ink, replacing descriptive navigation words (like 'Up/Down', 'Enter') with purely symbolic text (e.g., `↑↓`, `⏎`) to save horizontal space causes an accessibility regression. Screen readers in CLI environments rely on raw text output and fail to announce these symbols properly.
**Action:** Use visually concise but screen-reader-friendly text for keyboard navigation hints instead of relying solely on symbols.
