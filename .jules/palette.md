## 2026-08-08 - Dynamic list truncation feedback
**Learning:** When displaying dynamic lists in terminal UIs (such as those using `ink`), if the list is truncated to fit constraints (e.g., a `maxVisible` limit), it causes a loss of situational awareness if there is no explicit visual indicator.
**Action:** Always include an explicit visual indicator (like '... and X more tasks') when lists are truncated.
