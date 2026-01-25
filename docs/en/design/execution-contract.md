# Execution Contract

SalmonLoop follows a strict execution contract to ensure safety and determinism.

## Phase Guarantees

1. **PREFLIGHT**: Read-only. Checks environment safety (git repo).
2. **CONTEXT**: Read-only. Gathers codebase context and target file content.
3. **PLAN**: Read-only. The LLM analyzes the context and instruction to generate a JSON plan. No filesystem mutation occurs.
4. **PATCH**: Read-only. The LLM generates a unified diff based on the plan. No filesystem mutation occurs.
5. **VALIDATE**: Read-only. The system validates the diff against security and size limits.
6. **APPLY**: Mutating. The system applies changes using the **Shadow Merge Engine** (based on `git merge-file` 3-way merge). This engine merges Base (T0), User (Current), and AI (Generated) content, ensuring atomicity within dirty workspaces. After application, it performs **AST Verification** (if supported) to ensure syntax correctness.
7. **VERIFY**: Read-only. The system runs the user-provided verification command.
8. **ROLLBACK**: Mutating. If verification fails, the system restores the modified files to their original state using `git checkout`. If Git conflicts or abnormal states are detected, it performs a robust reset (`git stash`, `git reset --hard`, `git clean`).
9. **SHRINK**: Read-only. If verification fails, the system performs **Smart Feedback** analysis to extract precise error diagnostics and reduces the context for the next attempt.

## Safety Rules

### 1. Dirty Workspace Strategy (Zero Index Access)
When running in a dirty workspace (containing uncommitted changes), SalmonLoop strictly adheres to the **"Zero Index Access"** policy.

#### Design Philosophy
SalmonLoop acts as a **Guest**, not the Owner, within the user's repository.
- **Commitment vs Draft**: `git add` represents a user's firm commitment. The Worktree is a fluid draft space.
- **Do No Harm**: Automation tools must never destroy user commitments. Therefore, the Staged Area is read-only "context" for the AI, never a write "target".

#### Status Matrix
The system applies different write-back strategies based on the delta between the user's current state and the T0 snapshot (Base), **always** converging to Unstaged changes.

| Scenario | Base (T0) | User (Current) | AI (Patch) | Action | Final Status (git status) | Safety |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Clean** | `A` | `A` | `B` | Direct Write `B` | `M` (Unstaged) | ✅ Worktree Only |
| **Staged** | `A` | `B` (Includes Staged) | `C` | Merge `A+B+C` | `M` (Index) + `M` (Worktree) | ✅ Staged Preserved |
| **Unstaged** | `A` | `B` | `C` | Merge `A+B+C` | `M` (Unstaged - Fused) | ✅ User Edits Preserved |
| **Double Dirty** | `A` | `C` (Includes Staged `B`) | `D` | Merge `A+C+D` | `M` (Index) + `M` (Worktree - Fused) | ✅ **Absolute Safety** |

#### Core Principles
*   **Staged Area = Forbidden Zone**: Code already staged by the user is sacred. The AI will NEVER revert, modify, or overwrite staged content.
*   **Worktree = Draft Area**: All AI patches are applied ONLY as "Unstaged Changes" to the working directory, pending user review.
*   **Atomic Merging**: Uses a 3-way merge algorithm. If a conflict occurs, it aborts and generates `.rej` files; it never force-overwrites.

### 2. General Safety Rules
- **Atomic Attempts**: Each attempt is isolated. If an attempt fails, the workspace is rolled back before the next attempt starts. The rollback mechanism is robust against Git conflict states.
- **Force Reset & Clean**: When `forceReset` is enabled, SalmonLoop performs both `git reset --hard HEAD` and `git clean -fd` to ensure a completely clean workspace for the next attempt.
- **Structural Integrity**: SalmonLoop supports file Creation and Deletion, provided these operations are executed via the Shadow Transaction Manager and protected by atomic snapshots. Ad-hoc structural mutations outside the transaction scope remain strictly forbidden.
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
