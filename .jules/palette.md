## 2025-02-20 - Invisible Truncation in Terminal Lists
**Learning:** When displaying dynamic lists (like a Todo drawer) in a constrained terminal space, silently truncating the list (e.g. slicing up to `maxVisible`) hides the full scope of work, causing users to lose track of hidden tasks.
**Action:** Always add an explicit visual indicator (e.g., "... and X more tasks") when list items are truncated to preserve situational awareness without cluttering the UI.
