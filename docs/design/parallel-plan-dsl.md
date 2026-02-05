# Parallel Plan DSL (PPD)

English is the Single Source of Truth (SSOT).

This document describes the design and architecture of the Parallel Plan DSL used by SalmonLoop's tactical execution kernel. Implementation details belong in `src/core/tools/parallel/`.

## Scope

- The PPD serves as the **Tactical Execution Layer** of SalmonLoop.
- It is responsible for orchestrating atomic tool calls in a safe, parallel, and auditable manner.
- It sits below the **Grizzco Orchestration DSL** (Strategic Layer), which handles high-level agent logic.

## Relationship with Grizzco

SalmonLoop uses a two-tier orchestration model:

1.  **Grizzco DSL (Strategic)**: Decides *what* phases to run and *which* high-level actions to take (e.g., "Analyze this file", "Generate a patch").
2.  **Parallel Plan DSL (Tactical)**: Decides *how* to execute the specific tool calls required by those actions (e.g., "Read these 5 files in parallel", "Acquire a write lock before applying this patch").

Important: Grizzco's `ExecutionPlan` is **not** the PPD `ExecutionPlan`. The Grizzco plan must be translated into a PPD plan before the tactical executor runs.

## Core Principles

### 1. Separation of Intent and Constraint
The DSL allows agents to express logical dependencies (Node A must finish before Node B) without worrying about physical constraints (Node A and Node C can run in parallel because they don't share locks).

### 2. Metadata-Driven Governance
Locks and concurrency limits are not manually declared in the DSL. Instead, they are derived at runtime from tool metadata (`ToolSpec`).
- **Safe by Default**: If a tool isn't marked as `parallel_ok`, it defaults to serialized execution.
- **Dynamic Resource Locking**: Resource keys (e.g., `pathPrefix`) are computed JIT from tool arguments.

### 3. The Lane Model
To balance performance and safety, the execution engine uses a **Dual Lane** approach:
- **ReadLane**: Optimized for high-concurrency read/search operations.
- **WriteLane**: Strict serialization for state-mutating operations, protected by resource locks.

## Data Flow (OutputRef)

PPD supports a powerful data-pipelining mechanism called `OutputRef`. Nodes can reference the results of their predecessors using JSON-path expressions. This allows the tactical kernel to handle complex data dependencies (e.g., using the output of a search tool as the input for a read tool) without exiting to the agent loop.

## Safety & Isolation

- **Alphabetical Lock Sorting**: The kernel enforces a strict sorting protocol on resource keys before acquisition to physically prevent ABBA deadlocks.
- **Physical Isolation**: Tools marked for isolation are executed with unique `GIT_INDEX_FILE` and `TMPDIR` environments, ensuring that concurrent OS-level processes do not contaminate the main workspace or each other.

## Three-Layer Integration

- **Layer 1 (Tools)**: Wrapped into single-node execution plans.
- **Layer 2 (MicroTasks)**: Primary users of PPD, producing DAGs for complex tool sequences.
- **Layer 3 (Agents)**: Generate "Candidate Proposals" that are translated into PPD plans for safe execution.

## Where To Read More

- Technical Specification: `src/core/tools/parallel/parallel-plan-spec.md`
- Lock Management: `src/core/tools/parallel/lock-manager.ts`
- Execution Pipeline: `docs/design/execution-pipeline.md`
