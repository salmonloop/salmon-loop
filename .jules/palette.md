## 2026-06-26 - Accessible Navigation Hints
**Learning:** For complex command-line selection interfaces or overlays using Ink, descriptive navigation words (like 'Up/Down', 'Enter') should not be replaced with purely symbolic text (e.g., `↑↓`, `⏎`). Screen readers in CLI environments rely on raw text output and fail to announce these symbols properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text (e.g. 'Up/Down' instead of '↑↓') in terminal UI components.
