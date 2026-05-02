## 2024-04-27 - Added explicit focus indicators to Selection UI
**Learning:** List selections in Ink terminal UI components relying solely on color changes are not accessible for colorblind users. This is an accessibility issue specific to our terminal environment setup.
**Action:** Always include a structural or character-based focus indicator (e.g., `❯ `) for active item states in list interfaces, rather than relying solely on highlighting with color.
## 2024-05-18 - Improved discoverability of keyboard navigation in selection interfaces
**Learning:** Terminal UI selection overlays that use wordy textual descriptions for hints can be hard to discover or parse quickly. Compact, symbolic keyboard navigation hints (e.g., `↑↓ nav · space toggle · ⏎ confirm · esc cancel`) improve the visual density and discoverability of selection interfaces.
**Action:** Replace lengthy textual keyboard instructions with compact, symbolic hints using explicit symbols and verbs to guide user interactions in Ink UI overlays.
