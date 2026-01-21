# Execution Contract

SalmonLoop follows a strict execution contract to ensure safety and determinism.

## Phase Guarantees

1. **PREFLIGHT**: Read-only. Checks environment safety (git repo).
2. **CONTEXT**: Read-only. Gathers codebase context and target file content.
3. **PLAN**: Read-only. The LLM analyzes the context and instruction to generate a JSON plan. No filesystem mutation occurs.
4. **PATCH**: Read-only. The LLM generates a unified diff based on the plan. No filesystem mutation occurs.
5. **VALIDATE**: Read-only. The system validates the diff against security and size limits.
6. **APPLY**: Mutating. The system applies the patch using `git apply --3way`. After application, it performs **AST Verification** (if supported) to ensure syntax correctness.
7. **VERIFY**: Read-only. The system runs the user-provided verification command.
8. **ROLLBACK**: Mutating. If verification fails, the system restores the modified files to their original state using `git checkout`. If Git conflicts or abnormal states are detected, it performs a robust reset (`git stash`, `git reset --hard`, `git clean`).
9. **SHRINK**: Read-only. If verification fails, the system performs **Smart Feedback** analysis to extract precise error diagnostics and reduces the context for the next attempt.

## Safety Rules

- **No Dirty Workspace**: SalmonLoop will not start if there are uncommitted changes in the repository (unless using `worktree` strategy).
- **Atomic Attempts**: Each attempt is isolated. If an attempt fails, the workspace is rolled back before the next attempt starts. The rollback mechanism is robust against Git conflict states.
- **Force Reset & Clean**: When `forceReset` is enabled, SalmonLoop performs both `git reset --hard HEAD` and `git clean -fd` to ensure a completely clean workspace for the next attempt.
- **No File Operations**: SalmonLoop currently forbids creating, deleting, or renaming files to prevent accidental structural damage to the repository.
- **No Comment Translation**: The LLM is strictly forbidden from translating or modifying existing comments unless explicitly instructed, to preserve code integrity and context matching.

## Error Handling

- **Error Classification**: SalmonLoop classifies errors into several types:
    - `COMPILATION`: Syntax or type errors (Retryable).
    - `LINT`: Code style violations (Retryable).
    - `TEST`: Functional test failures (Retryable).
    - `LOGIC`: Verification failed without specific framework errors (Retryable).
    - `AST_VALIDATION_ERROR`: Deep AST structure or scope integrity check failed (Retryable).
    - `DEPENDENCY_ERROR`: Missing or mismatched dependencies (Non-retryable).
    - `RESOURCE_LOCK_ERROR`: Concurrent access or file lock conflicts (Non-retryable).
    - `UNKNOWN`: Uncategorized errors (Non-retryable).

- **Retry Strategy**: Only errors classified as retryable will trigger a new attempt with reduced context and refined feedback. Non-retryable errors result in immediate termination to prevent infinite loops or resource damage.

- **Fail-Fast**: Any unexpected system error results in an immediate rollback and termination.
- **Structured Results**: The loop returns a `LoopResult` object containing the success status, failure phase, error type, and detailed logs.
