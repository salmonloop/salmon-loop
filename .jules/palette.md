## 2024-05-18 - Screen-reader friendly navigation hints
**Learning:** For complex command-line selection interfaces or overlays using Ink, while concise microcopy saves horizontal space, replacing descriptive navigation words (like 'Up/Down', 'Enter') with purely symbolic text (e.g., `↑↓`, `⏎`) causes screen readers to fail to announce these symbols properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text like 'Up/Down nav · Enter select · Esc close' instead of symbols.
