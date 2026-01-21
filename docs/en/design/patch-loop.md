# Design Rationale: Patch Loop

The core of SalmonLoop is a formalized execution loop designed to be "predictable, explainable, and embeddable."

## 1. Formalized Execution Phases

The loop follows a strict nine-phase process:
1. **PREFLIGHT**: Read-only. Checks environment safety (git repo, dirty workspace).
2. **CONTEXT**: Read-only. Gathers codebase context and target file content.
3. **PLAN**: Read-only. LLM generates a structured modification plan.
4. **PATCH**: Read-only. LLM generates a unified diff based on the plan.
5. **VALIDATE**: Read-only. Enforces safety limits, performs fuzzy context matching, and ensures the diff is valid.
6. **APPLY**: Mutating. The **only** phase that writes changes to the disk. After application, it performs **Deep AST Verification**.
7. **VERIFY**: Read-only. Runs user-provided checks (e.g., tests).
8. **ROLLBACK**: Mutating. Restores the filesystem state if verification fails.
9. **SHRINK**: Read-only. Reduces context for the next attempt based on failure signals.

## 2. Safety Guarantees

- **Atomic Changes**: Changes are applied via `git apply`. If any part of the patch fails, nothing is applied.
- **Reliable Rollbacks**: Rollbacks are targeted and based on the specific files changed in the current attempt. If Git conflicts or abnormal states are encountered, the system automatically performs a forced reset or isolation cleanup, ensuring the workspace returns to a predictable state. Specifically, in the worktree strategy, the isolation ensures that unsuccessful changes never affect the main workspace.
- **No File Operations**: Prohibiting file creation, deletion, and renaming ensures that the execution environment remains stable and reversible. The validation phase provides detailed feedback if these rules are violated.
- **Fuzzy Context Matching**: Uses Levenshtein distance to validate patch context against the actual file content, allowing for minor whitespace or comment differences while ensuring structural correctness.

## 3. Observability & Defensive Monitoring

- **Structured Logs**: Every step is logged with its corresponding `ExecutionPhase`.
- **Failure Attribution**: Errors are explicitly linked to the phase where they occurred (e.g., `failurePhase: VALIDATE`).
- **Performance Metrics**: The system tracks durations for apply-back operations and success rates using an internal `Monitor`.
- **Infrastructure Health**: Explicitly monitors for checkpoint creation failures and cleanup errors to identify Git infrastructure issues.
