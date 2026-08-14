## 2026-08-14 - Explicit visual indicator for truncated lists
**Learning:** When displaying dynamic lists in terminal UIs (such as those using ink), if the list is truncated to fit constraints (e.g., a maxVisible limit), always include an explicit visual indicator (like '... and X more tasks') to preserve user situational awareness.
**Action:** When working on terminal UIs and implementing slice or limits to arrays for visualization, add a footer element that explicitly calls out the truncation and gives users a sense of total items remaining.
