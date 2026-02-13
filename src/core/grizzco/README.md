# Grizzco Engine (Internal)

This directory implements the Grizzco execution pipeline (Bifrost) and the rule-based orchestration DSL.

## Internal Docs

- `ARCHITECTURE.md`: detailed internal architecture, ownership boundaries, migration status.
- `DSL-Spec-V3.md`: internal whitepaper/specification.

## Key Concepts

- Pipeline phase order is the external contract in `docs/design/execution-contract.md`.
- Single-attempt mode flow assembly lives in `flows/SalmonLoopFlow.ts`.
- Cross-attempt transaction policy lives in `engine/transaction/*`.
- Per-file routing decisions are expressed in `dsl/*`; side effects are executed by `execution/*` + `workers/*`.

## Directory Map (Summary)

- `flows/`: single-attempt mode flow assembly.
- `engine/pipeline/`: typed pipeline kernel and progressive context contracts.
- `engine/transaction/`: retry policy and terminal transaction mapping.
- `engine/outcome/`: maps transaction report to `LoopResult`.
- `engine/observability/`: event/log adaptation and telemetry.
- `steps/`: phase implementations (PREFLIGHT/CONTEXT/EXPLORE/...).
- `dsl/`: sync-only rule engine.
- `execution/`: plan executor and worker factory.
- `workers/`: micro executors (per-file/per-operation).
- `runtime/`: host/apply-back runtime integrations.
- `services/`: async data providers for DSL ping-pong.
- `validation/`: context contract validation.

## Implementation Notes

PATCH operations are treated as atomic patch instructions and must not be reconstructed into full file content.
This is a safety requirement to prevent data loss.

## Phase Notes

- `steps/explore.ts` runs a read-only tool loop and enriches context before PLAN.
- `steps/plan.ts` detects if the configured LLM exposes `chatStream`; if so it routes through `chatWithToolsStreaming`, which collects streaming deltas/tool calls before invoking the shared executor from `core/tools/session.ts`. This maintains the read-only contract for PLAN while allowing streaming models to emit partial content or tool invocations without breaking the loop.
- The DSL and tool governance layers receive the same audit-friendly helper output as the legacy path, so strategy rules remain unchanged even when the tool loop switches to streaming.
