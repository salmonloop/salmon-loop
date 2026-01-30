# Strata Runtime (Internal)

This directory contains the runtime environment and safety mechanisms that support:
- Worktree execution
- Safe snapshot creation and restore
- Apply-back to the main workspace

## Key Modules

- `runtime/environment.ts`: chooses the active execution path (main repo vs worktree).
- `checkpoint/manager.ts`: snapshot creation and restore-to-shadow behavior.
- `runtime/synchronizer.ts`: apply-back logic (dirty workspace preservation, rollback safeguards).
- `layers/worktree.ts`: worktree creation/teardown with path safety checks.

## Design Notes

Public, stable design contracts live under `docs/design/`.
This README documents implementation-level details and may change as code evolves.

