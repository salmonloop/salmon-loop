# Current SalmonLoop Behavior (Refactor Wave 2)

This note captures the existing `runSalmonLoop` behavior for each `FlowMode` so we can track regressions during the refactor.

## Shared responsibilities

- `runSalmonLoop` handles setup/teardown (`RuntimeEnvironment`), event sanitization, event/log aggregation, and final `LoopResult` assembly.
- Retry orchestration, history accumulation, and terminal failure classification are delegated to `LoopExecutionCoordinator`.
- `executeSalmonLoopFlow` uses the Grizzco `Pipeline` plus a `FlowStrategy` to drive the macro phases documented in `docs/design/execution-contract.md`.
- `apply-back` is now a first-class pipeline phase (`APPLY_BACK`) in mutating strategies (`patch`/`debug`).

## Patch flow (`FlowMode = 'patch'`)

- Phases: `PREFLIGHT → CONTEXT → EXPLORE → PLAN → PATCH → VALIDATE → AST_VALIDATE → APPLY → VERIFY → ROLLBACK → SHRINK → APPLY_BACK`
- Loop retries up to `LIMITS.maxRetries` when the pipeline throws or `ctx.verifyResult.ok === false`.
- On verify success, `APPLY_BACK` executes inside the strategy pipeline (worktree only) and persists telemetry/audit events.
- On verify failure it increments `retries`, emits a `retry` event, and retries after updating `currentContext`/`currentLastError`.
- Apply-back failures are terminal (no retry) and map to `LoopResult.failurePhase = Phase.APPLY_BACK` + `reasonCode = 'APPLY_BACK_FAILED'`.
- Events emitted: `phase.start/phase.end` for each pipeline step, `retry`, `workspace.ready`, `run.start/end`, plus logs aggregated with the last started phase.

## Review flow (`FlowMode = 'review'`)

- Phases: `PREFLIGHT → CONTEXT → EXPLORE → REVIEW → REPORT → SHRINK`
- `executeSalmonLoopFlow` returns success after `SHRINK`; review strategy does not include `APPLY_BACK`.
- A dry-run still skips mutation and keeps `verifyArtifact`/`authorizationSummary` propagation in host result mapping.
- No retries because `FlowStrategy` neither throws nor sets `verifyResult.ok`.

## Debug flow (`FlowMode = 'debug'`)

- Includes review/analyze phases before executing full patch pipeline.
- Behavior mirrors patch flow for the mutating tail (`PLAN` onward), including retries and in-pipeline `APPLY_BACK`.
- Successful run returns identical fields to patch mode.

## Event/log scattering

- `wrappedEmit` (loop scope) sanitizes error logs and always records them as `PREFLIGHT` entries in `logs`.
- `loopEmit` (inside retry loop) records `phase.start` metadata to associate `log` entries with the current phase.
- `history` collects per-attempt `plan`, `patch`, and `context` snapshots, while `logs` contains every sanitized log entry with a best-effort phase mapping.

## Notes for regression tests

1. Verify that a successful patch run keeps `reasonCode = 'SUCCESS'`, `finalPatch`, and `changedFiles` populated and emits `retry` only when needed.
2. Verify that verification failures increment `retries` and end with `reasonCode = 'MAX_RETRIES'` after exhaustion.
3. Verify that apply-back failure is captured as `APPLY_BACK_FAILED` with `failurePhase = Phase.APPLY_BACK`.
4. Review flow should skip apply-back and emit no `retry` events.
5. Confirm `loopEmit` always emits the correct `history` phase in logs even when sanitize/wrapped emit also runs.
