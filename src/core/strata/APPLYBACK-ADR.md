# ADR: Apply-Back / Shadow Merge Strategy (Internal)

Status: Accepted (internal ADR)

Date: 2026-01-29

Context: SalmonLoop / Bifrost v3

This document is an internal design record. Public, stable contracts live under `docs/design/`.

---

## Problem Statement

SalmonLoop v3 introduces a "shadow workspace + apply-back" model:

- Generate and verify changes in an isolated environment.
- Apply verified results back to the user's main workspace.
- Failures MUST NOT corrupt the user's working state.
- The user may continue editing during execution (dirty workspace).

Apply-back must address:

1. Atomicity: multi-file changes should be all-or-nothing.
2. Base explicitness: apply-back must be anchored to an explicit, auditable T0 snapshot.
3. Topology support: add/delete/rename/mode changes (and binary where possible).
4. Explainability and maintainability: behavior must be auditable and debuggable.

---

## Audit of the Legacy (develop) Mechanism

The legacy develop branch used a per-file "ShadowMergeEngine" approach and did NOT use `git apply`:

- Text modifications:
  - `git merge-file -p base ours theirs`
  - Produces standard conflict markers.
- Added files:
  - `fs.writeFile`
- Deleted files:
  - `fs.unlink`
- Binary files:
  - skipped (functional gap)

Rollback behavior existed, but it effectively relied on coarse restoration to a clean HEAD, which is not safe
for dirty workspaces where staged and/or unstaged changes exist.

Conclusion:
- The legacy approach had coarse atomicity.
- It could not safely restore a dirty workspace.

---

## v3 (Bifrost) Delta

v3 keeps the stable core:
- Text content conflict resolution can continue to use explicit 3-way semantics (merge-file-like behavior).

v3 adds missing capabilities:
- Dirty workspace transactions:
  - capture a pre-apply snapshot of the dirty state and restore it on failure.
- Binary support:
  - use binary diffs (`git diff --binary`) and patch application where appropriate.
- Topology handling:
  - represent add/delete/rename/mode changes through patch semantics rather than ad-hoc filesystem operations.

---

## Core Tradeoff: `git apply --3way` vs `git merge-file`

### Explicit merge-file approach

Pros:
- Base/Ours/Theirs are explicit and auditable.
- Conflicts are explainable and predictable.
- Easier to debug.

Costs:
- Requires application-level implementations for topology (rename/delete/mode/symlink) and binary handling.
- Cross-platform behavior (case sensitivity, permissions, attributes) becomes complex.
- This is historically the most error-prone layer.

### Patch-driven apply approach (`git apply`)

Pros:
- Unified representation for topology changes.
- Supports binary patches.
- Reduces custom filesystem edge-case logic.

Risks:
- Base may be implicit unless explicitly validated and anchored.
- Behavior can depend on git config and attributes.
- It is "patch replay", not a fully explicit state merge unless constrained externally.

---

## Decision

Adopt a hybrid strategy:

- Use explicit 3-way merge semantics for content merge scenarios where predictability and conflict explainability
  is required.
- Use patch-driven application (`git apply`, optionally `--3way` when safe) for topology and binary coverage.

---

## Non-Negotiable Constraints

1) Transaction / Undo log
- Before apply-back mutates the main workspace, capture the dirty workspace state.
- On failure, restore the workspace to its original dirty state (staged + unstaged + untracked as applicable).
- Do not rely solely on `git reset --hard` for dirty restoration.

2) Explicit base anchoring (T0)
- Apply-back must be anchored to an explicit T0 snapshot.
- When patch-driven application is used, base integrity must be validated (no implicit base guessing).

3) Deterministic apply
- Capture and/or control inputs that affect apply behavior (whitespace, EOL, attributes) where feasible.

4) Audit and explainability
- Record T0, engine selection (explicit merge vs patch), affected file set, conflicts, and rollback.

---

## References

- Source ADR: `plans/ADR.md` (Chinese)
- Public contract: `docs/design/applyback.md`

