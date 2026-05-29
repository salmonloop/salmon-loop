## 2024-05-29 - List Selection Focus Indicator Consistency
**Learning:** In terminal UI applications (like Ink), relying purely on color differences or narrow visual markers (`│ `) for list selection focus is not accessible for colorblind users or when terminal themes vary. It creates ambiguity.
**Action:** Always include a distinct, structural focus indicator (specifically `❯ `) for active list items, ensuring it remains visible across color themes. Consistent spacing (`  `) must be used for unselected items to prevent layout shifts.
