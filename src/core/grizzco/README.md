# Grizzco Engine (Internal)

This directory implements the V3 execution pipeline and the rule-based orchestration DSL.

## Key Concepts

- Pipeline phases are defined as a contract in `docs/design/execution-contract.md`.
- Workers are selected by the DSL strategy based on operation intent and file status.

## Key Modules

- `flows/SalmonLoopFlow.ts`: the canonical phase order.
- `steps/*`: phase implementations (context, plan, patch, validate, apply, verify, rollback, shrink).
- `dsl/*`: rule engine used to select safe workers for a given file/operation.
- `workers/*`: execution engines (e.g., git-apply, merge workers).

## Whitepaper (Internal)

- `DSL-Spec-V3.md`: internal architecture + DSL specification (translated). Not a public contract.

## Implementation Notes

PATCH operations are treated as atomic patch instructions and must not be reconstructed into full file content.
This is a safety requirement to prevent data loss.
