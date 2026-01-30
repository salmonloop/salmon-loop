# Grizzco V3 "Bifrost" Architecture

## Overview

The Grizzco V3 Architecture (codenamed "Bifrost") is the next-generation engine for the SalmonLoop automated coding system. It is designed to solve the complexity of managing asynchronous operations (like LLM calls, Git operations) within a deterministic decision-making process.

## Core Design Principles

### 1. Separation of Orchestration and Decision

- **Macro-Orchestration (Pipeline)**: Handles the linear flow of phases (`PREFLIGHT` -> `CONTEXT` -> `PLAN` ...). It manages state transitions and error recovery.
- **Micro-Decision (DSL)**: Handles the logic within a specific phase (e.g., choosing a merge strategy). It is pure, synchronous, and side-effect free.

### 2. The Ping-Pong Protocol (Async Bridge)

To allow the synchronous DSL to make decisions based on asynchronous data (e.g., "Is the remote file locked?"), V3 introduces a suspension mechanism:

1. **Decision Engine** encounters a `requireData('key')` rule.
2. If data is missing, it returns a `NEED_DATA` signal.
3. **Micro-Orchestrator** pauses execution, fetches the data from the **Service Registry**.
4. The context is enriched, and the Decision Engine is re-run.

### 3. Progressive Contexts

Type safety is enforced by "Progressive Contexts". Each step in the pipeline receives a specific context type (e.g., `PatchCtx`) and returns a richer one (e.g., `ValidateCtx`). This guarantees that data availability matches the execution stage.

## Key Components

### Pipeline (`src/core/grizzco/v3/pipeline.ts`)

A typed, async pipeline engine that supports:

- **Steps**: Atomic units of work.
- **Recovery**: `stepWithRecovery` allows handling failures (e.g., Emergency Rollback).
- **Telemetry**: Built-in tracing (Spans) for performance monitoring.

### Decision Engine (`src/core/grizzco/v3/dsl/DecisionEngine.ts`)

A pure TypeScript class that executes the DSL strategies. It generates a structured `ExecutionPlan` (JSON) describing what should be done, without doing it.

### Executor (`src/core/grizzco/v3/execution/Executor.ts`)

The "muscle" of the system. It takes an `ExecutionPlan` and performs the actual side effects (File writes, Git merges) using dedicated Workers.

### Service Registry (`src/core/grizzco/v3/services/registry.ts`)

A central hub for asynchronous data providers (`GitConfigService`, etc.), enabling the Ping-Pong protocol to fetch data dynamically.

## Directory Structure

```
src/core/grizzco/v3/
├── dsl/            # Pure Decision Logic
├── execution/      # Side-effect Executors & Workers
├── flows/          # Macro Orchestration (SalmonLoopV3)
├── services/       # Data Fetchers
├── steps/          # Pipeline Steps
├── pipeline.ts     # Pipeline Engine
└── types.ts        # Progressive Context Definitions
```
