# Orchestration DSL (Grizzco)

English is the Single Source of Truth (SSOT).

This document describes the stable, public-facing parts of the Grizzco orchestration DSL used by SalmonLoop.
Implementation details belong in `src/core/grizzco/`.

## Scope

- The DSL applies to per-file decision-making in the APPLY phase.
- The pipeline (PREFLIGHT -> CONTEXT -> PLAN -> PATCH -> VALIDATE -> AST_VALIDATE -> APPLY -> VERIFY -> ROLLBACK -> SHRINK) is orchestration and is not expressed in the DSL.

## Core Principles

- Separation of concerns:
  - Pipeline orchestrates phases and owns async I/O.
  - DSL evaluates rules and produces an execution plan.
- Sync-only DSL:
  - DSL predicates and actions are synchronous and side-effect-free.
  - Async dependencies are requested via a data requirement signal.
- Audit as data:
  - Decisions are emitted as structured data so they can be audited and replayed.

## Execution Plan (Concept)

The DSL produces a plan-like artifact describing:
- What checks were applied
- Which routing rules matched
- Which worker/actions were selected

This artifact is intended to be serializable and auditable.

## Async Bridge

When the DSL needs data (e.g., remote lock status), it does not fetch it directly.
Instead it signals a need, and an orchestrator (specifically `MicroTaskRunner`) fetches the data and enriches context before re-running the DSL.

## Triage Role
`MicroTaskRunner` serves as the Layer 2 executor in the Three-Layer Triage model, ensuring deterministic data resolution without the overhead of a full Agent loop.

## Where To Read More

- Execution contract: `docs/design/execution-contract.md`
- Pipeline overview: `docs/design/execution-pipeline.md`
- Tool governance: `docs/design/tool-governance.md`
- Internal whitepaper: `src/core/grizzco/DSL-Spec-V3.md`

