## 2026-08-17 - Dynamic List Truncation Awareness
**Learning:** When displaying dynamic lists (like the Todo Drawer) in terminal UIs, truncating elements without a visual indicator severely reduces user situational awareness.
**Action:** Always include an explicit visual indicator (like '... and X more tasks') when limiting `maxVisible` items to preserve context.
