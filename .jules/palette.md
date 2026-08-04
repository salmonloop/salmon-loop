## 2026-08-04 - Truncation Indicators in Terminal UIs
**Learning:** When displaying dynamic lists in terminal UIs (such as those using `ink`), if the list is truncated to fit constraints (e.g., a `maxVisible` limit), silently dropping items leads to a loss of situational awareness.
**Action:** Always include an explicit visual indicator (like '... and X more tasks') when lists are truncated to preserve user context and improve accessibility.
