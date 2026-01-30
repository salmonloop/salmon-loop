# Execution Safety

This document describes the safety boundaries and when SalmonLoop may mutate files.

## High-Level Contract

- PLAN/PATCH/VALIDATE/AST_VALIDATE are intended to be read-only with respect to the target repository content.
- APPLY mutates the active execution workspace (worktree when using the worktree strategy).
- VERIFY executes the user-provided command (read-only for repo content, but it may create build artifacts).
- Apply-back mutates the main workspace only after VERIFY passes (unless `--dry-run` is enabled).

## Worktree Safety Model

- A safe snapshot is created before worktree execution begins.
- The shadow worktree is restored to preserve staged/unstaged semantics.
- Apply-back uses a dirty-workspace backup approach when the main repo is dirty and apply-back policy allows it.

## What You Should Always Provide

- A meaningful `--verify` command that fails on quality regressions.
- `-cs worktree` when running against dirty repositories.

