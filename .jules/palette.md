## 2026-08-29 - Truncation Awareness
**Learning:** When displaying dynamic lists in terminal UIs (such as those using `ink`), if the list is truncated to fit constraints (e.g., a `maxVisible` limit), it is important to include an explicit visual indicator to preserve user situational awareness.
**Action:** Always add an explicit UI element indicating truncation and count, rather than silently hiding items.

## 2026-09-04 - Text Wrapping in Ink Sidebar
**Learning:** In terminal UIs with constrained sidebar width, long strings break layout and formatting if not handled properly. Text elements need `wrap="truncate"` within a `Box` that uses `flexGrow=1` in a `flexDirection="row"` layout to behave well.
**Action:** When adding task lists or freeform text to sidebars, always use `Box` with `flexGrow` and `Text` with `wrap="truncate"`.
