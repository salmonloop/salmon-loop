## 2024-05-24 - Screen Reader Compatibility in CLI Overlays
**Learning:** For complex command-line selection interfaces or overlays using Ink, purely symbolic text (e.g., `↑↓`, `⏎`) fails with screen readers, causing an accessibility regression. Descriptive navigation words must be used.
**Action:** Use visually concise but screen-reader-friendly text like 'Up/Down' and 'Enter' instead of raw symbols.
