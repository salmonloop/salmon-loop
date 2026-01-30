# Overview

SalmonLoop is an automated code patching loop that prioritizes user data safety.
It generates a plan, produces a unified diff, applies it in an isolated workspace when possible, verifies the result, and applies changes back safely.

## What It Does

- Produces small, reviewable diffs to implement an instruction.
- Supports dirty workspaces via the worktree strategy.
- Provides structured auditing and phased execution logs.

## What It Does Not Do (Non-goals)

- It does not guarantee semantic correctness of changes without a verification command.
- It does not run arbitrary shell commands from the model; tool execution is policy-governed.

