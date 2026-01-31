# Grizzco Engine (Internal)

This directory implements the Grizzco execution pipeline (Bifrost) and the rule-based orchestration DSL.

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

## PLAN Phase Streaming

- `steps/plan.ts` detects if the configured LLM exposes `chatStream`; if so it routes through `chatWithToolsStreaming`, which collects streaming deltas/tool calls before invoking the shared executor from `core/tools/session.ts`. This maintains the read-only contract for PLAN while allowing streaming models to emit partial content or tool invocations without breaking the loop.
- The DSL and tool governance layers receive the same audit-friendly helper output as the legacy path, so strategy rules remain unchanged even when the tool loop switches to streaming.
