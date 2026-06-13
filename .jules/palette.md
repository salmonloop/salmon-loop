## 2026-06-13 - Screen Reader Accessible Terminal Navigation
**Learning:** Screen readers in CLI environments (using Ink) fail to properly announce symbolic navigation characters (like `↑↓` or `⏎`), causing an accessibility regression compared to raw descriptive text.
**Action:** When designing terminal command selection interfaces or tooltips, always use visually concise but screen-reader-friendly text (e.g., 'Up/Down', 'Enter', 'Esc') instead of pure symbols to ensure accessibility.
