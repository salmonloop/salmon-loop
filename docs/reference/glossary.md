# Glossary

## Worktree

A temporary git worktree used to execute changes in isolation from the main repository.

## Snapshot (T0)

A safe checkpoint created before execution begins. Used as a rollback anchor.

## APPLY / apply-back

- APPLY: applies the generated patch to the active execution workspace.
- apply-back: copies/merges the resulting changes from the execution workspace back to the main repository.

## MM

The git status where a file is modified in both index and working tree (staged + unstaged).

