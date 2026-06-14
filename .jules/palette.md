## 2024-06-14 - Screen Reader Friendly Navigation Hints
**Learning:** Screen readers in CLI environments (and some terminal fonts) struggle to interpret or read symbolic navigation characters like `↑↓` or `⏎`, which breaks accessibility for visually impaired users relying on text-based UI hints.
**Action:** Replaced symbolic arrows with explicitly spelled out words (`Up/Down`, `Enter`) in `CommandSuggestionList.tsx` to ensure screen readers announce keyboard shortcuts correctly without relying purely on visual symbols.
