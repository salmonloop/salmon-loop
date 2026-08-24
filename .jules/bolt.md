## 2024-05-24 - Pre-compute Pad Arrays for Frequent Rendering
**Learning:** In high-throughput React `ink` terminal UI render paths, repeated string allocations for basic time formatting (like `String().padStart(2, '0')`) create measurable overhead.
**Action:** Use pre-computed array lookups (e.g., `const PAD_2 = Array.from({ length: 60 }, (_, i) => (i < 10 ? \`0${i}\` : \`${i}\`))`) for bounded data like 0-59 to reduce performance overhead.
