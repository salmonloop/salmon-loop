## Initial Palette Journal

## 2026-08-28 - Truncated Dynamic Lists Need Indicators
**Learning:** When displaying dynamic lists in terminal UIs (such as those using `ink`), truncating the list to fit constraints without a visual indicator causes users to lose situational awareness of remaining items.
**Action:** Always include an explicit visual indicator (like '... and X more tasks') when applying a `maxVisible` limit to a dynamic list.