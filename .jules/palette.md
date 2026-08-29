## 2026-08-29 - Truncation Awareness
**Learning:** When displaying dynamic lists in terminal UIs (such as those using `ink`), if the list is truncated to fit constraints (e.g., a `maxVisible` limit), it is important to include an explicit visual indicator to preserve user situational awareness.
**Action:** Always add an explicit UI element indicating truncation and count, rather than silently hiding items.
