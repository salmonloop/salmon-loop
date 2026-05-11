## 2025-05-11 - Command list focus indicators
**Learning:** The `CommandSuggestionList` component was using a color-only reliance for indicating the selection (`│` with salmon vs blank), making it inconsistent with the rest of the app which utilizes a proper structural indicator (`❯`) in the list navigation options (like in `CommandInput`). This is problematic for accessibility, specifically colorblindness.
**Action:** Replaced the salmon colored `│` focus indicator with a clear, structural `❯` focus indicator in cyan to make the active row selection distinct and consistent across all lists.
