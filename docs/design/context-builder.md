# Design Rationale: Context Builder

The `ContextBuilder` is responsible for gathering and shrinking the information provided to the LLM. It follows a deterministic, rule-based approach to ensure stability and predictability.

## 1. Information Gathering Pipeline

The builder follows a clear pipeline:
1. **Primary Text**: Read the primary file content (or selection).
2. **Keyword Extraction**: Simple extraction from user instructions.
3. **Ripgrep Search**: Uses `rg --json` for robust, machine-readable results.
4. **Git Diff**: Captures staged/unstaged changes (scope-controlled).
5. **AST Analysis**: Identifies definitions/references in the primary file and collects imported dependency files.
6. **Smart Compression**: Reduces noise in non-primary context sources (see below).
7. **Relevance Scoring**: Reorders candidates to spend budget on the most useful context first.
8. **Truncation (Pack-Until-Full)**: Fits gathered data into the character budget.

## 2. AST-Enhanced Context
The builder uses Tree-sitter to perform lightweight AST analysis on the primary file:
- **Definitions**: These are locations where functions, classes, or variables are defined. LLMs are instructed to modify these with caution.
- **References**: Marked with `ℹ️`. These indicate where symbols are used, providing usage context without needing to pull in entire files.

In addition, imported files referenced by the primary file are collected as "related files". Large related files are downgraded to an outline representation (exports, types, class/function signatures) to keep the context compact and stable.

The AST gatherer also emits a deterministic `repo_map` manifest:
- **Nodes**: primary/import files with traversal depth.
- **Edges**: import relationships (`from -> to`).
- **Trigger mode**: `shallow` (default) or `deep` (when instruction intent implies cross-file refactor/migration/dependency work).

## 3. Truncation Strategy: Pack-Until-Full

Instead of proportional truncation, we use a "pack-until-full" strategy:
- **Priority**: `primaryText` > `relatedFiles` > `rgSnippets` > diffs.
- **Complete Units**: We prioritize keeping whole related files/snippets until the budget is reached.
- **Noise Reduction**: diffs are dropped once the budget is exceeded to avoid distracting the LLM with unrelated changes.

## 4. Structured Prompt Assembly (XML)

The context block emitted for prompts is structured as XML using explicit tags and CDATA sections:
- The tag boundaries reduce accidental mixing of instructions and context.
- CDATA avoids unintended escaping of code characters (e.g., `if (a < b)` remains readable).

This is optimized for strong delimitation and predictable parsing by LLMs.

## 5. Smart Compression

To "spend tokens where it matters", the builder applies deterministic compression before budgeting:
- **Related files**: Strip comments (optionally preserve JSDoc at higher budgets), normalize trailing whitespace, and cap consecutive blank lines.
- **Diffs and snippets**: Normalize whitespace and reduce empty-line noise.
- **Large files**: Prefer a stable outline representation over full text.

Compression is never applied to the primary file content.

## 6. Deterministic Shrinking

When a verification fails, the context is shrunk based on:
- **Failed Files**: Extracted from the verification output (e.g., stack traces).
- **Static Dependencies**: Limited expansion of related files (configurable by deterministic depth).
- **Dynamic Depth (Heuristic)**: If the failure looks like missing imports/types/symbols, the next attempt expands dependencies deeper.
- **Hard Caps**: Strict limits on the number of related files and snippets to prevent context bloat.

The shrunk context also carries a refined "last error" summary into the next PLAN/PATCH prompts to help the model correct the failure without reintroducing unrelated context.

## 7. Heuristic Budgeting

All limits are character-based rather than token-based. This makes the system:
- **Model-Agnostic**: Works consistently across different LLM providers.
- **Predictable**: Easy to reason about memory and resource usage.
- **Stable**: Avoids the complexity and overhead of local tokenization.

Budget planning exposes an explicit **60-30-10** split in metadata/audit:
- **60% Primary** (`primaryText`)
- **30% Related** (`relatedFiles`)
- **10% Secondary** (`rgSnippets` + diffs)

The runtime still applies deterministic `pack-until-full`; the split is an explicit planning/audit contract, not a hard per-section truncation wall.
