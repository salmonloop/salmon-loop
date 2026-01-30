# Execution Pipeline

This document describes the execution phases and their responsibilities.

## Phases (Order)

1. PREFLIGHT
2. CONTEXT
3. PLAN
4. PATCH
5. VALIDATE
6. AST_VALIDATE
7. APPLY
8. VERIFY
9. ROLLBACK
10. SHRINK

The phase order is a contract and must match runtime behavior.

## Side-Effect Boundaries (Summary)

- PLAN/PATCH are intended to be read-only with tool-calling constrained by policy.
- APPLY mutates the active execution workspace (e.g., a temporary worktree).
- ROLLBACK may be a no-op when verification succeeds; the phase is still present for uniform flow reporting.

## Retry Inputs (PLAN/PATCH)

When VERIFY fails, later attempts may be informed by:
- A refined error summary ("last error") derived from the previous verification output.
- A shrunk/re-ranked context assembled from the failed files and their dependencies.
