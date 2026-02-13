# Execution Contract - DSL V3.1 (Bifrost Extended)

**Version**: 3.1.0  
**Date**: 2026-02-06  
**Status**: Adopted

SalmonLoop follows a strict execution contract to ensure safety, determinism, and user data protection.
Version 3.1 introduces multi-mode workflows via mode-aware pipeline assembly while preserving the existing
safety guarantees of the patch pipeline.

## Flow Pipeline Architecture (V3.1)

SalmonLoop no longer hardcodes a single linear pipeline. Instead, it assembles mode-specific pipelines
on top of a shared base (PREFLIGHT + CONTEXT + EXPLORE).

- **Single-attempt phase execution**: `executeSalmonLoopFlow` builds and executes the pipeline for the current mode.
- **Cross-attempt transaction control**: `FlowTransactionRunner` (`src/core/grizzco/engine/transaction/transaction-runner.ts`) owns retries, terminal failure mapping, and attempt audit events.
- **Single source of truth**: Mode-to-phase mapping lives in `src/core/grizzco/flows/SalmonLoopFlow.ts`.

## Standard Flow Modes

- **Patch**: Full modification cycle (PLAN → PATCH → VALIDATE → AST_VALIDATE → APPLY → VERIFY → ROLLBACK → SHRINK → APPLY_BACK).
- **Review**: Analysis-only workflow (REVIEW → REPORT → SHRINK). No filesystem mutation.
- **Debug**: Combined workflow (REVIEW → ANALYZE_ISSUES → PLAN → PATCH → VALIDATE → AST_VALIDATE → APPLY → VERIFY → ROLLBACK → SHRINK → APPLY_BACK).

## ReadOnlyFileSystem Enforcement

Review mode routes filesystem access through a `ReadOnlyFileSystem` adapter. Any attempt to write
(e.g., `writeFile`, `mkdirSync`) raises a permission error, providing a defense-in-depth guarantee
even if a tool call or step tries to mutate the workspace.

## Auditability Enhancements

`FlowReport` now records `strategyName` and `fsMode`, making it explicit which strategy executed and
whether the filesystem was in read-only or read/write mode.

## Bootstrap (Phase 0)

Before the phase lifecycle begins, SalmonLoop may prepare an isolated execution environment.

This bootstrap step is **required** for the `worktree` strategy and includes operations such as:
- Creating a safe snapshot (T0) for rollback and deterministic diffing.
- Creating a temporary shadow worktree under the system temp directory.

Safety guarantees:
- Bootstrap **MUST NOT** modify the user's main workspace **working tree** or **index**.
- Bootstrap **MAY** write internal Git metadata (e.g. refs under `refs/s8p/*`, `.git/worktrees/*`) and create temporary directories.
- If bootstrap fails, SalmonLoop **MUST** terminate without applying any changes to the main workspace.

## Phase Guarantees

1. **PREFLIGHT**: Read-only. Checks environment safety (git repo).
2. **CONTEXT**: Read-only. Gathers codebase context and target file content.
3. **PLAN**: Read-only. The LLM analyzes the context and instruction to generate a JSON plan.
4. **PATCH**: Read-only. The LLM generates a unified diff based on the plan.
5. **VALIDATE**: Read-only. The system validates the diff against security and size limits. It may also perform AST-based validation (syntax and scope integrity) on the proposed changes.
6. **APPLY**: Mutating (shadow workspace). The system applies changes using an intent-routed **Shadow Merge Engine**: incremental diffs (PATCH) are applied via the native `git apply` engine (optionally `--3way` when safe), while full-file merges may use 3-way content merge workers (e.g., `git merge-file`). This preserves atomicity and staged/unstaged semantics within dirty workspaces.
7. **VERIFY**: Read-only. The system runs the user-provided verification command.
8. **ROLLBACK**: Mutating. If verification fails, the system restores the modified files to their original state using `git checkout`. If Git conflicts or abnormal states are detected, it performs a robust reset (`git stash`, `git reset --hard`, `git clean`).
9. **SHRINK**: Read-only. If verification fails, the system performs **Smart Feedback** analysis to extract precise error diagnostics and reduces the context for the next attempt.

10. **APPLY_BACK**: Mutating (main workspace, worktree mode only). On successful verification, changes are synchronized from shadow workspace to the user's main workspace with dirty-workspace safety policy and audit telemetry.

**Definition (Read-only):** In SalmonLoop, "read-only" means:
- **No mutation of user repository assets** in the user's main workspace working tree (tracked or untracked).
  - This explicitly includes untracked files such as `.env`, credentials, local config, datasets, etc.
- **No mutation of the Git index** (Zero Index Access).

Read-only phases **MAY** write a narrow set of **runtime artifacts / metadata** that are explicitly scoped to SalmonLoop:
- OS temp artifacts owned by the current run.
- Files under `.salmonloop/**` (intentionally local-only runtime state).
- A restricted Git metadata exception: writing `.git/info/exclude` **only** to add `.salmonloop/` (local ignore), to prevent runtime artifacts from dirtying the repo.

All allowed runtime writes must remain within these approved roots. Any write outside these roots is a contract violation.

**Tool-calling restriction (PLAN/PATCH):**
- The only model-visible write capability allowed in read-only phases is updating the runtime plan file under `.salmonloop/plans/**` via `plan.*` tools.
- No other tool may write to the repository during PLAN/PATCH, even if the target file is untracked.

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
