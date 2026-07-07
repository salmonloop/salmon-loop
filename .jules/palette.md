## 2024-05-24 - Accessible navigation instructions in Ink components
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce symbols like `↑↓` or `⏎` properly, causing an accessibility regression. Descriptive navigation words (like 'Up/Down', 'Enter') are required instead of purely symbolic text for command-line selection interfaces or overlays using Ink.
**Action:** Use visually concise but screen-reader-friendly text (e.g., 'Up/Down' instead of '↑↓', 'Enter' instead of '⏎') for navigation hints in CLI components.
