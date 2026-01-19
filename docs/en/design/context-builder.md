# Design Rationale: Context Builder

The `ContextBuilder` is responsible for gathering and shrinking the information provided to the LLM. It follows a deterministic, rule-based approach to ensure stability and predictability.

## 1. Information Gathering Pipeline

The builder follows a clear pipeline:
1. **Keyword Extraction**: Simple extraction from user instructions.
2. **Ripgrep Search**: Uses `rg --json` for robust, machine-readable results.
3. **Git Diff**: Captures current workspace changes.
4. **Truncation**: Fits gathered data into the character budget.

## 2. Truncation Strategy: Pack-Until-Full

Instead of proportional truncation, we use a "pack-until-full" strategy:
- **Priority**: `primaryText` > `rgSnippets` > `gitDiff`.
- **Complete Snippets**: We prioritize keeping complete code snippets until the budget is reached.
- **Noise Reduction**: `gitDiff` is dropped if the budget is exceeded to avoid distracting the LLM with unrelated changes.

## 3. Deterministic Shrinking

When a verification fails, the context is shrunk based on:
- **Failed Files**: Extracted from the verification output (e.g., stack traces).
- **Static Dependencies**: Limited expansion of related files.
- **Hard Caps**: Strict limits on the number of related files and snippets to prevent context bloat.

## 4. Heuristic Budgeting

All limits are character-based rather than token-based. This makes the system:
- **Model-Agnostic**: Works consistently across different LLM providers.
- **Predictable**: Easy to reason about memory and resource usage.
- **Stable**: Avoids the complexity and overhead of local tokenization.
