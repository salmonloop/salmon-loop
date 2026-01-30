# Git Adapter (Internal)

This directory contains the git execution layer used by higher-level systems.

## Safety Notes

- Applying generated diffs must avoid full-file overwrites for incremental patches.
- `git apply -3` requires valid preimage blob ids; generated diffs may contain unsafe/fake `index` lines.
- All git mutation must be constrained to the intended workspace (worktree vs main repo).

This README is implementation-focused. Public safety promises belong in `docs/`.

