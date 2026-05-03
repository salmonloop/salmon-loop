## 2024-04-27 - Added explicit focus indicators to Selection UI
**Learning:** List selections in Ink terminal UI components relying solely on color changes are not accessible for colorblind users. This is an accessibility issue specific to our terminal environment setup.
**Action:** Always include a structural or character-based focus indicator (e.g., `❯ `) for active item states in list interfaces, rather than relying solely on highlighting with color.
## 2025-05-03 - Consistent Structural Focus Indicators
**Learning:** Found an inconsistent use of selection indicators ('│ ' instead of '❯ ') in `CommandSuggestionList.tsx`. Relying on colors or subtle lines is less clear than a directional caret.
**Action:** Standardized on '❯ ' for all command/list selections to provide a strong structural focus indicator that enhances accessibility without relying on color alone.
