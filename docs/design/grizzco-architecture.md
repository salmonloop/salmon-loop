# Grizzco "Bifrost" Architecture

## Overview

The Grizzco Architecture (codenamed "Bifrost") is the execution engine for the SalmonLoop automated coding system. It is designed to solve the complexity of managing asynchronous operations (like LLM calls, Git operations) within a deterministic decision-making process.

## Core Design Principles

### 1. Separation of Orchestration and Decision

- **Macro-Orchestration (Pipeline)**: Handles the linear flow of phases (`PREFLIGHT` -> `CONTEXT` -> `PLAN` ...). It manages state transitions and error recovery.
- **Micro-Decision (DSL)**: Handles the logic within a specific phase (e.g., choosing a merge strategy). It is pure, synchronous, and side-effect free.

### 2. The Ping-Pong Protocol (Async Bridge)

To allow the synchronous DSL to make decisions based on asynchronous data (e.g., "Is the remote file locked?"), Bifrost introduces a suspension mechanism:

1. **Decision Engine** encounters a `requireData('key')` rule.
2. If data is missing, it returns a `NEED_DATA` signal.
3. **Micro-Orchestrator** pauses execution, fetches the data from the **Service Registry**.
4. The context is enriched, and the Decision Engine is re-run.

### 3. Progressive Contexts

Type safety is enforced by "Progressive Contexts". Each step in the pipeline receives a specific context type (e.g., `PatchCtx`) and returns a richer one (e.g., `ValidateCtx`). This guarantees that data availability matches the execution stage.

## Key Components

### Pipeline (`src/core/grizzco/engine/pipeline/pipeline.ts`)

A typed, async pipeline engine that supports:

- **Steps**: Atomic units of work.
- **Recovery**: `stepWithRecovery` allows handling failures (e.g., Emergency Rollback).
- **Telemetry**: Built-in tracing (Spans) for performance monitoring.

### Flow Transaction Runner (`src/core/grizzco/engine/transaction/transaction-runner.ts`)

Cross-attempt orchestration for macro flows:

- Runs repeated attempts with bounded retry policy.
- Carries forward shrunk context and refined last error across attempts.
- Emits attempt-level audit events (`loop.attempt.*`) and terminal outcome metadata.
- Delegates single-attempt phase execution to `executeSalmonLoopFlow`.

### Decision Engine (`src/core/grizzco/dsl/DecisionEngine.ts`)

A pure TypeScript class that executes the DSL strategies. It generates a structured `ExecutionPlan` (JSON) describing what should be done, without doing it.

### Executor (`src/core/grizzco/execution/Executor.ts`)

The "muscle" of the system. It takes an `ExecutionPlan` and performs the actual side effects (File writes, Git merges) using dedicated Workers.

### Service Registry (`src/core/grizzco/services/registry.ts`)

A central hub for asynchronous data providers (`GitConfigService`, etc.), enabling the Ping-Pong protocol to fetch data dynamically.

## Current Migration Status

- Grizzco has completed the structural split for:
  - `engine/transaction` (cross-attempt control),
  - `engine/outcome` (result mapping),
  - `engine/observability` (event/log adaptation),
  - `runtime` (host/apply-back integrations).
- `flows/` now intentionally contains only single-attempt flow assembly (`SalmonLoopFlow`).
- `services/implementations` is split into `default/` and `mock/`.
- Pipeline kernel/types are now consumed directly from `engine/pipeline/*`.

## Directory Structure

```
src/core/grizzco/
├── dsl/            # Pure Decision Logic
├── engine/         # Pipeline kernel + transaction/outcome/observability control plane
│   ├── pipeline/   # Pipeline core and progressive context contracts
│   ├── transaction/# Cross-attempt retries / terminal mapping
│   ├── outcome/    # LoopResult mapping from execution report
│   └── observability/ # Event adaptation and telemetry aggregation
├── execution/      # Side-effect Executors & Workers
├── flows/          # Single-attempt mode flow assembly
├── runtime/        # Host and apply-back runtime integrations
├── services/       # Async data providers for DSL ping-pong
│   └── implementations/
│       ├── default/ # Runtime defaults (e.g. git_config)
│       └── mock/    # Deterministic stubs (e.g. remote_lock, user_quota)
└── steps/          # Pipeline Steps
```
