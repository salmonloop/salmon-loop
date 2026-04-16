# Grizzco Internal Architecture

Status: internal implementation guidance (not external contract)

## Purpose

This document is the internal, implementation-oriented architecture map for `src/core/grizzco`.
Public guarantees remain in `docs/design/`.

## Runtime Flow (High Level)

1. `loop.ts` builds host/runtime context and telemetry adapters.
2. `engine/transaction/transaction-runner.ts` executes cross-attempt control.
3. For each attempt, `flows/SalmonLoopFlow.ts` assembles the mode pipeline and runs one full pass.
4. Pipeline executes phase steps from `steps/*` with typed context narrowing.
5. `steps/apply.ts` runs DSL decision + executor + worker dispatch per operation.
6. `engine/outcome/loop-result-mapper.ts` maps execution reports into stable `LoopResult`.

## Directory Responsibilities

### `flows/`

- Owns only single-attempt flow assembly.
- `SalmonLoopFlow.ts` is the source of truth for mode-to-phase order.
- No cross-attempt retry logic should live here.

### `engine/pipeline/`

- Pipeline kernel and context contracts.
- `pipeline.ts`: typed async pipeline (`step`, `stepWithRecovery`, tracing).
- `types.ts`: progressive context model (`InitCtx -> ... -> ShrinkCtx`).
- These files are the macro orchestration skeleton.

### `engine/transaction/`

- Cross-attempt orchestration and terminal control plane.
- Responsibilities:
  - retry decisions,
  - attempt failure classification,
  - terminal/retry-exhausted report mapping,
  - attempt-level audit event emission.

### `engine/outcome/`

- Maps transaction report into external `LoopResult`.
- Must not own retry policy or execution orchestration.

### `engine/observability/`

- Adapts loop events and logs into telemetry-friendly structures.
- Keeps event-shaping concerns out of flow and transaction layers.

### `steps/`

- Per-phase implementations used by `SalmonLoopFlow`.
- Rule of thumb:
  - each file = one phase concern,
  - no cross-attempt policy,
  - context-in/context-out through pipeline types.

### `dsl/`

- Pure, synchronous decision logic for per-file routing in APPLY.
- DSL emits execution plan data only; no direct I/O side effects.

### `execution/`

- Executes `ExecutionPlan` side effects.
- `Executor` + `WorkerFactory` + worker runtime behavior.

### `workers/`

- Micro executors (file/operation granularity).
- Must implement `IMergeWorker`.
- Should not contain pipeline, retry, or telemetry orchestration.

### `runtime/`

- Runtime integrations with host/strata/apply-back.
- Includes environment boot and apply-back synchronization runtime.

### `services/`

- Async data providers used by DSL ping-pong.
- `implementations/default/`: runtime default providers.
- `implementations/mock/`: deterministic mock providers used as defaults/stubs.

### `validation/`

- Context and invariants validation.
- Defensive checks before execution reaches irreversible side effects.

## Migration Status Checklist

- Done:
  - `flows/*` split into `engine/*` + `runtime/*` where appropriate.
  - `services/implementations` split into `default/` and `mock/`.
  - Cross-attempt policy extracted from flow assembly.
  - Internal/consumer imports moved from `grizzco/pipeline.ts` and `grizzco/types.ts` to `engine/pipeline/*`.
  - Compatibility re-export shims removed.
  - `executeSalmonLoopFlowLegacy` removed.

## Guardrails

- Keep flow assembly and transaction policy separated.
- Keep DSL pure and synchronous.
- Keep worker scope narrow (single operation, deterministic side effects).
- Keep docs updated whenever phase order or ownership boundaries change.
