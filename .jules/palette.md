## 2026-08-29 - Truncation Awareness
**Learning:** When displaying dynamic lists in terminal UIs (such as those using `ink`), if the list is truncated to fit constraints (e.g., a `maxVisible` limit), it is important to include an explicit visual indicator to preserve user situational awareness.
**Action:** Always add an explicit UI element indicating truncation and count, rather than silently hiding items.

## 2026-08-31 - Visual Pagination and Tab-Completion Hints in Terminal UIs
**Learning:** Terminal UI lists with `maxVisible` limits that truncate suggestions (like `CommandSuggestionList`) can cause users to lose situational awareness of how many total items exist, and hidden tab-completion shortcuts can be unintuitive for users expecting standard terminal behavior. Adding pagination indicators (e.g., `1-5 of 12`) and explicit shortcut hints (`⇥ complete`) dramatically improves discoverability and clarity without cluttering the interface.
**Action:** When designing or updating truncated lists in terminal UIs (like ink), always include a visual indicator of the total item count and explicit hints for available keyboard shortcuts (like tab completion) in the status bar to preserve context and discoverability.
