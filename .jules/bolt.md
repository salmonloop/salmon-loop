## 2026-07-22 - Optimize minIndent calculation
**Learning:** Using reduce with regex and string operations like match and replace in a hot loop (like rendering Markdown lines) is significantly slower (by ~17x) than a specialized for loop iterating over characters and avoiding string allocation or regex overhead.
**Action:** When parsing lines for whitespace indentation, prefer manual character loops over regex and string allocations if it's in a hot path.
