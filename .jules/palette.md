## 2026-08-11 - List Truncation Awareness
**Learning:** When displaying dynamic lists in terminal UIs (such as those using `ink`), if the list is truncated to fit constraints (e.g., a `maxVisible` limit), always include an explicit visual indicator (like '... and X more tasks') to preserve user situational awareness.
**Action:** Always check for length > maxVisible when rendering lists and append a truncation indicator.
