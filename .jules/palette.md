## 2026-08-22 - Truncation Indicators in Terminal Lists
**Learning:** Users lose situational awareness when dynamic lists in terminal UIs are silently truncated to fit constraints (like `maxVisible`).
**Action:** Always include an explicit visual indicator (e.g., "... and X more tasks") when slicing arrays for terminal list displays.