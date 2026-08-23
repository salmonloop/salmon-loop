## 2026-08-23 - Truncation Awareness in Terminal UIs
**Learning:** In space-constrained terminal UIs built with Ink, dynamically truncating long lists (like Todo items) without an explicit visual indicator leads to a loss of user situational awareness, causing them to miss off-screen data.
**Action:** When implementing bounded or scrollable lists in terminal components (e.g., using a `maxVisible` prop), always include a trailing element (e.g., `... and X more tasks`) to communicate hidden content.
