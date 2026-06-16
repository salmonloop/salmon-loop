## 2024-06-16 - Replace symbolic navigation hints with text
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce symbols like `↑↓` or `⏎` properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text like `Up/Down` and `Enter` instead of symbols for keyboard navigation hints in Ink CLI overlays.
