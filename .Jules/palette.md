## 2024-05-18 - Ink CLI Color Accessibility
**Learning:** Using only color changes (e.g. gray to green) to indicate selection state in Ink terminal UI components makes the CLI inaccessible to colorblind users. Furthermore, hardcoded color names lack consistency with the central theme (`COLORS`).
**Action:** Always include a structural or character-based focus indicator (like `❯`) for list selections, and enforce the use of `src/cli/ui/styles/theme.ts` for consistent text styling in Ink components.
