# First Run Demo (Worktree + Safety)

This document walks through a first run where:
- The main repository may be dirty.
- Execution happens in a temporary worktree.
- Changes are verified before applying back.

## Steps

1. Choose `-cs worktree` for isolation.
2. Provide `--verify` that reflects your real quality gate (e.g., `bun run test`, `bun run `, `bun run  -- --noEmit`).
3. Inspect the final diff and audit output if the run fails.

## Where Files Are Written

- Worktree strategy creates a temporary worktree under the system temp directory.
- Audit logs are written under `.salmonloop/runtime/audit/` in the SalmonLoop project working directory.
