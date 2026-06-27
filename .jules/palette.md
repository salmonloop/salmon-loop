## 2026-06-27 - Replace symbolic text in CLI overlays
**Learning:** For complex command-line selection interfaces or overlays using Ink, replacing descriptive navigation words (like 'Up/Down', 'Enter') with purely symbolic text (e.g., `↑↓`, `⏎`) causes an accessibility regression. Screen readers in CLI environments rely on raw text output and fail to announce these symbols properly.
**Action:** Use visually concise but screen-reader-friendly text (e.g. 'Up/Down' instead of '↑↓') in Ink UI components.
