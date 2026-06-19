## 2024-05-18 - Improve screen-reader accessibility for CLI navigation hints
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce symbols like `↑↓` and `⏎` properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text (e.g. 'Up/Down' instead of '↑↓') for complex command-line selection interfaces or overlays using Ink.
