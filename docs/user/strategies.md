# Strategies

SalmonLoop supports two execution strategies:

## direct

- Runs directly in the repository working directory.
- Best for clean workspaces and simple workflows.

## worktree (recommended)

- Runs in a temporary git worktree under the system temp directory.
- Designed for safety and isolation, especially when the main workspace is dirty.

## Key Semantics

- In worktree mode, the active execution path is the worktree path, not the main repo path.
- Apply-back to the main repo occurs after VERIFY passes (unless `--dry-run` is enabled).

