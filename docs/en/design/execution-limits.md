# Design Rationale: Execution Limits

SalmonLoop uses intentional constraints to ensure automated patching is deterministic, reviewable, and safe.

## 1. Patch Safety Limits

- **`maxFilesChanged = 2`**: Enforces locality. Most reliable fixes are single-file or small cross-file adjustments. Prevents unintended large-scale refactors.
- **`maxDiffLines = 200`**: Ensures patches remain human-reviewable and semantically focused. Large diffs signal that a task should be decomposed.
- **`maxRetries = 2`**: Prevents infinite self-correction loops. Encourages early failure with actionable feedback when context or instructions are ambiguous.

## 2. Context Budget Limits

- **`maxContextChars = 30000`**: Heuristic upper bound for model-agnostic, predictable memory usage. Fits comfortably in modern LLM windows.
- **`maxPrimaryChars = 12000`**: Caps primary file content to maintain high signal-to-noise ratio, preventing massive files from dominating context.
- **`minContextChars = 5000`**: Protects against over-shrinking during retries, ensuring the LLM always has enough information to make decisions.

## 3. Search and Shrink Limits

- **`maxKeywords = 3`**: Keeps ripgrep searches focused on the specific instruction, avoiding broad repository-wide noise.
- **`maxRelatedFiles = 20`**: Bounded expansion of static dependencies during context shrinking to ensure deterministic performance.
- **`maxSnippetsAfterShrink = 30`**: Caps retained code snippets after shrinking to stabilize context size.
- **`minSnippetChars = 64`**: Filters out meaningless code fragments and partial tokens.

## 4. Verification Output Limits

- **`verifyOutputMaxLines = 300`**: Captures essential failure signals (stack traces, compiler errors) without bloating context with irrelevant logs.

## Summary

These limits enforce a **disciplined execution loop**. SalmonLoop favors small, local changes and deterministic behavior over speculative automation to **maximize trust in automated changes**.
