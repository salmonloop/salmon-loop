## 2024-05-24 - Accessibility focus indicator in CommandSuggestionList
**Learning:** Relying solely on color changes (or ambiguous characters like `│ `) for focus indication in Ink terminal list selections can be inaccessible for colorblind users and lacks clarity.
**Action:** Always include a structural or character-based focus indicator (specifically `❯ ` for consistency) in Ink terminal UI components to ensure accessibility.
