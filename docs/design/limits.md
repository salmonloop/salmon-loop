# Execution Limits

To ensure stability and prevent runaway costs or resource exhaustion, SalmonLoop enforces several hard limits.

## Context Limits

- **Max Context Characters**: 30,000 chars. The total size of the prompt sent to the LLM.
- **Max Primary Characters**: 12,000 chars. The maximum size of the target file or selection.
- **Max Keywords**: 3. The maximum number of keywords extracted for ripgrep search.
- **Min Snippet Characters**: 64. Snippets smaller than this are dropped during truncation.

## Modification Limits

- **Max Files Changed**: 2. SalmonLoop will refuse to apply a patch that modifies more than 2 files.
- **Max Diff Lines**: 200. The total number of added/removed lines in a patch cannot exceed 200.
- **Max Retries**: 2. The loop will attempt to fix errors up to 2 times (total 3 attempts).

## Verification Limits

- **Max Verify Output Lines**: 300. Only the first 300 lines of the verification command output are processed and sent back to the LLM.

## Logging Limits

- **Max Log Length**: 10,000 chars. Individual log entries are truncated to this length to prevent memory issues.

## Why these limits?

These limits are designed to keep the LLM focused on small, manageable tasks. Large changes are more likely to introduce bugs and are harder for the LLM to reason about correctly. If your task exceeds these limits, consider breaking it down into smaller sub-tasks.
