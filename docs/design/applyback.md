# Apply-Back (Shadow -> Main)

English is the Single Source of Truth (SSOT).

This document describes SalmonLoop's apply-back behavior at a contract level. Apply-back is the process of
bringing verified changes from the execution workspace (e.g., a worktree) back to the user's main workspace.

## Goals

- Safety first: failures must not corrupt the user's workspace.
- Transactional semantics: apply-back should be all-or-nothing for the intended change set.
- Support dirty workspaces where users may have local changes (staged and/or unstaged).
- Support topology changes (add/delete/rename/mode) and binary changes where feasible.

## Summary of the Chosen Approach (Hybrid)

SalmonLoop uses a hybrid merge strategy:

- For content merges where explicit 3-way semantics are required, the system may use explicit 3-way merge
  behavior (e.g., `git merge-file`) to preserve predictable conflict markers and explainability.
- For patch-driven changes (including topology and binary changes), the system may use `git apply` (optionally
  `--3way` when safe and supported) as a patch interpreter.

The key point is not which tool is used, but that apply-back is guarded by safety constraints and can be rolled
back without losing the user's pre-existing dirty state.

## Hard Constraints (Non-Negotiables)

### 1) Transactional rollback (Undo log)

- Apply-back MUST be transactional.
- If any part fails, the system MUST restore the user's workspace to the original state observed at apply-back
  entry (including staged and unstaged state).
- The rollback mechanism MUST NOT rely solely on `git reset --hard` because that cannot safely restore dirty
  workspaces.

### 2) Explicit base anchoring (T0)

- Apply-back MUST be anchored to an explicit base snapshot (T0) created before execution.
- When patch-driven application is used, the base must be treated as explicit and auditable, not inferred.

### 3) Deterministic apply

- Apply behavior MUST be performed in a controlled environment and should avoid hidden sources of nondeterminism
  (whitespace, EOL, and git attributes can affect results).

### 4) Auditability

- The system MUST record which engine/strategy was used (e.g., explicit merge vs patch apply).
- The system MUST record the base ref (T0) and the affected file set.

## Related Documents

- Execution contract: `docs/design/execution-contract.md`
- Execution pipeline: `docs/design/execution-pipeline.md`
- Execution safety (user-facing): `docs/user/execution-safety.md`

