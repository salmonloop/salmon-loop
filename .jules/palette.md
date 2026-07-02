## 2024-07-02 - Replace symbolic navigation characters with text for screen reader accessibility
**Learning:** Screen readers in CLI environments rely on raw text output and fail to announce symbolic navigation characters like `↑↓` or `⏎` properly, causing an accessibility regression.
**Action:** Use visually concise but screen-reader-friendly text like `Up/Down` and `Enter` instead of symbols for keyboard navigation hints.
