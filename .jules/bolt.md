## 2025-02-14 - Optimize Markdown React Re-renders
**Learning:** Terminal components doing heavy synchronous processing (like parsing marked-terminal strings) can drastically degrade interactive UI performance if they re-render unconditionally on every keystroke/tick.
**Action:** Always wrap these heavy leaf components (like `Markdown`) in `React.memo` if their props are primarily stable scalars (strings/numbers), avoiding deep object equality overhead while eliminating redundant parsing.
