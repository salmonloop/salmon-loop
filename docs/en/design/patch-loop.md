# Design Rationale: Patch Loop

The core of SalmonLoop is a formalized execution loop designed to be "predictable, explainable, and embeddable."

## 1. Formalized Execution Phases

The loop follows a strict seven-step process:
1. **PLAN**: Read-only. LLM generates a structured modification plan.
2. **PATCH**: Read-only. LLM generates a unified diff based on the plan.
3. **VALIDATE**: Read-only. Enforces safety limits and ensures the diff is valid.
4. **APPLY**: Mutating. The **only** phase that writes changes to the disk.
5. **VERIFY**: Read-only. Runs user-provided checks (e.g., tests).
6. **ROLLBACK**: Mutating. Restores the filesystem state if verification fails.
7. **SHRINK**: Read-only. Reduces context for the next attempt based on failure signals.

## 2. Safety Guarantees

- **Atomic Changes**: Changes are applied via `git apply`. If any part of the patch fails, nothing is applied.
- **Reliable Rollbacks**: Rollbacks are targeted and based on the specific files changed in the current attempt, preventing accidental loss of unrelated work.
- **No File Operations**: Prohibiting file creation, deletion, and renaming ensures that the execution environment remains stable and reversible.

## 3. Observability

- **Structured Logs**: Every step is logged with its corresponding `ExecutionPhase`.
- **Failure Attribution**: Errors are explicitly linked to the phase where they occurred (e.g., `failurePhase: VALIDATE`).
- **History Tracking**: Each iteration is recorded, allowing for detailed analysis of how the system converged on a solution.
