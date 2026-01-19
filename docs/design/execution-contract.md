# Execution Contract

SalmonLoop follows a strict execution contract to ensure safety and determinism.

## Phase Guarantees

1. **PREFLIGHT**: Read-only. Checks environment safety (git repo, dirty workspace).
2. **CONTEXT**: Read-only. Gathers codebase context and target file content.
3. **PLAN**: Read-only. The LLM analyzes the context and instruction to generate a JSON plan. No filesystem mutation occurs.
4. **PATCH**: Read-only. The LLM generates a unified diff based on the plan. No filesystem mutation occurs.
5. **VALIDATE**: Read-only. The system validates the diff against security and size limits.
6. **APPLY**: Mutating. The system applies the patch using `git apply --3way`. This is the only phase that modifies the filesystem.
7. **VERIFY**: Read-only. The system runs the user-provided verification command.
8. **ROLLBACK**: Mutating. If verification fails, the system restores the modified files to their original state using `git checkout`.
9. **SHRINK**: Read-only. If verification fails, the system reduces the context for the next attempt based on the error output.

## Safety Rules

- **No Dirty Workspace**: SalmonLoop will not start if there are uncommitted changes in the repository (unless `allowDirty` is true).
- **Safety Guard**: The combination of `allowDirty: true` and `forceReset: true` is strictly forbidden to prevent accidental loss of uncommitted user changes.
- **Atomic Attempts**: Each attempt is isolated. If an attempt fails, the workspace is rolled back before the next attempt starts.
- **No File Operations**: SalmonLoop currently forbids creating, deleting, or renaming files to prevent accidental structural damage to the repository.

## Error Handling

- **Fail-Fast**: Any unexpected error (e.g., git command failure, LLM timeout) results in an immediate rollback and termination.
- **Structured Results**: The loop returns a `LoopResult` object containing the success status, failure phase, and detailed logs.
