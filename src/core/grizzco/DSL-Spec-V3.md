# Grizzco Architecture & DSL Specification v3.0

Status: Internal / subject to change

Version: 3.0.0 (Codename: "Bifrost" - The Bridge Between Order and Chaos)

Release date: 2026-01-29

Architecture level: DCAP-compliant (Decision, Computation, Action, Persistence)

Audience: Grizzco / SalmonLoop core team, security audit team

Important:
- This document is an internal implementation whitepaper.
- It is NOT a public contract. Public, stable guarantees live under `docs/design/`.
- For the SSOT execution contract, see `docs/design/execution-contract.md`.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architectural Principles](#2-architectural-principles)
3. [Layer 1: Macro Orchestration](#3-layer-1-macro-orchestration)
   - [3.1 Typed Async Pipeline](#31-typed-async-pipeline)
   - [3.2 Progressive Context](#32-progressive-context)
   - [3.3 Telemetry and Observability](#33-telemetry-and-observability)
4. [Layer 2: Micro Decision Engine](#4-layer-2-micro-decision-engine)
   - [4.1 DSL Grammar (v3)](#41-dsl-grammar-v3)
   - [4.2 Execution Plan](#42-execution-plan)
   - [4.3 Purity and Side Effects](#43-purity-and-side-effects)
5. [Core Mechanism: The Async Bridge](#5-core-mechanism-the-async-bridge)
   - [5.1 Ping-Pong Protocol](#51-ping-pong-protocol)
   - [5.2 Context Enrichment](#52-context-enrichment)
   - [5.3 Micro Orchestrator](#53-micro-orchestrator)
6. [Reference Implementation](#6-reference-implementation)
7. [Anti-Patterns](#7-anti-patterns)
8. [Migration Guide](#8-migration-guide)
9. [Appendix: Pain-Point Mapping](#9-appendix-pain-point-mapping)

---

## 1. Executive Summary

Grizzco v3.0 aims to address three core issues observed in v1/v2:

- Orchestration vs decision confusion
- Broken async control
- Type system collapse

This specification establishes the **Dual-Layer Separation** architecture:

1. **Macro layer**: uses a **Typed Async Pipeline** to drive SalmonLoop's linear lifecycle (phased execution). It treats async I/O as a first-class concern and preserves type-safe context flow across phases.
2. **Micro layer**: uses a **TransactionStrategy DSL** to route per-file execution strategies. It emphasizes synchronous logic, declarative rules, and auditability.

The two layers interact through an **on-demand Ping-Pong Protocol**, achieving both logical decoupling and runtime coordination.

---

## 2. Architectural Principles

Per RFC 2119, this document uses the following keywords: **MUST**, **SHOULD**, **MUST NOT**.

### 2.1 Separation of Concerns

- The **Pipeline MUST** only handle phase flow, exception capture, and data passing.
- The **DSL MUST** only evaluate rules and generate an execution plan.
- The **DSL MUST NOT** perform any I/O directly (including logging, filesystem, or network).

### 2.2 Explicit Async

- In the macro flow, all I/O **MUST** use native `async/await`.
- In the micro DSL, `Promise` and `async` **MUST NOT** appear. Async dependencies must be delegated outward via a "Need Data" signal.

### 2.3 Audit as Data

- All critical decisions **MUST** produce a serializable JSON object (`ExecutionPlan`).
- Execution plans **MUST** be persisted or logged before execution.

---

## 3. Layer 1: Macro Orchestration

Role: Infrastructure / Skeleton

Core patterns: Chain of Responsibility + Monad + Telemetry

### 3.1 Typed Async Pipeline

The macro flow is no longer driven by the DSL. It is driven by a strongly-typed Pipeline container.

#### 3.1.1 Pipeline Definition

```ts
/**
 * Step definition
 * In: output of the previous step
 * Out: output of this step (becomes input for the next step)
 */
type Step<In, Out> = (ctx: In) => Promise<Out>;

/**
 * Pipeline container
 */
class Pipeline<CurrentCtx> {
  private constructor(
    private readonly promise: Promise<CurrentCtx>,
    private readonly telemetry: TelemetryCollector,
  ) {}

  // Static factory
  static of<T>(ctx: T): Pipeline<T>;

  // Core chaining
  step<NextCtx>(name: string, action: Step<CurrentCtx, NextCtx>): Pipeline<NextCtx>;

  // Terminal execution
  async execute(): Promise<FlowReport>;
}
```

#### 3.1.2 Error Handling

The Pipeline wraps each step in a global `try/catch`. Any step exception (e.g., `GitDirtyError`, `LLMQuotaExceeded`) aborts the flow and is recorded into a structured report.

#### 3.1.3 Transaction Control Plane (Cross-Attempt)

Macro orchestration has two complementary responsibilities:

1. **Single-attempt phase execution** (Pipeline): run phase steps linearly and return `FlowReport`.
2. **Cross-attempt transaction control** (Flow Transaction Runner): apply retry policy, carry forward shrunk context/last error, and produce terminal outcome mapping.

In the current implementation this control plane is represented by:
- `src/core/grizzco/flows/SalmonLoopFlow.ts` (single-attempt phases)
- `src/core/grizzco/flows/flow-transaction-runner.ts` (cross-attempt orchestration)

This separation preserves the rule that the Pipeline itself remains a typed phase executor, while transaction policy stays explicit and auditable.

### 3.2 Progressive Context

To address v1's "Context full of optional fields" problem, v3 introduces **context type narrowing**.

#### 3.2.1 Phase-by-Phase Context Types

Context is no longer a god object. It is a set of interfaces that grow with the flow:

```ts
// Stage 0: init
interface InitCtx {
  options: GlobalOptions;
}

// Stage 1: after preflight (always contains gitStatus)
interface PreflightCtx extends InitCtx {
  gitStatus: GitStatus;
}

// Stage 2: after context building (always contains analysis)
interface ContextCtx extends PreflightCtx {
  analysis: CodebaseAnalysis;
}

// Stage 3: after plan (always contains rawPlan)
interface PlanCtx extends ContextCtx {
  rawPlan: LLMPlanResponse;
}
```

#### 3.2.2 Benefits of Type Flow

When implementing the `PLAN` phase, TypeScript can guarantee `ctx.gitStatus` exists. Developers do not need defensive checks like `if (!ctx.gitStatus) throw ...`.

### 3.3 Telemetry and Observability

The Pipeline enables sidecar-style telemetry by default and collects per-step metadata automatically.

#### 3.3.1 Report Structure

```ts
interface FlowExecutionReport {
  flowId: string;
  startTime: number;
  totalDuration: number;
  success: boolean;
  error?: SerializedError;
  steps: StepRecord[]; // linear trace
  artifacts: Record<string, any>; // key artifact index
}

interface StepRecord {
  phase: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'SKIPPED';
  duration: number;
  meta?: any; // step-defined metadata (e.g., git hash, token usage)
}
```

---

## 4. Layer 2: Micro Decision Engine

Role: Domain Logic / Brain

Core patterns: Fluent Interface + Strategy Pattern

### 4.1 DSL Grammar (v3)

The DSL is used only inside the **APPLY** phase, for **per-file** merge/worker selection.

#### 4.1.1 Basic Syntax

The DSL is a purely synchronous fluent chain:

```ts
StandardStrategy(engine)
  .phase('PhaseName') // used for log grouping only

  // Assertion: if false, throw and abort the decision
  .require(predicate, failureReason)

  // Branch: if true, execute an action (mutates the plan builder)
  .when(predicate, action)

  // Data dependency declaration: requests async data
  .requireData('key_name');
```

#### 4.1.2 Predicates

Predicates MUST be pure functions `(c: Context) => boolean`:

- OK: `c => c.file.isBinary`
- Forbidden: `async c => await check(c)` (no async)
- Forbidden: `c => { window.count++ }` (no side effects)

#### 4.1.3 Actions

Actions may only mutate the `PlanBuilder` and MUST NOT execute business logic:

- OK: `p => p.setWorker('3way')`
- OK: `p => p.reject('Locked')`
- Forbidden: `p => fs.writeFileSync(...)` (no I/O)

### 4.2 Execution Plan

The DSL output is an immutable JSON object used as an audit artifact.

```json
{
  "traceId": "uuid-v4",
  "file": "src/main.ts",
  "decisionTree": [
    "OK [Check] Not Symlink",
    "OK [Check] Remote Lock (Unlocked)",
    "OK [Match] File is MM -> Use 3way-merge"
  ],
  "finalAction": {
    "type": "MERGE",
    "workerId": "3way-merge",
    "params": { "strategy": "theirs" }
  }
}
```

### 4.3 Purity and Side Effects

- Purity: given the same input context (including already-loaded data), the DSL **MUST** produce the same execution plan.
- Side effects: the DSL engine **MUST NOT** produce side effects. All side effects are delegated to the executor that runs the `ExecutionPlan`.

---

## 5. Core Mechanism: The Async Bridge

This is the key innovation that resolves the tension between "the DSL needs data" and "the DSL must be synchronous".

### 5.1 Ping-Pong Protocol

The DSL engine communicates with an external orchestrator via a tagged result type:

```ts
type DecisionResult =
  // Protocol A: decision complete
  | { type: 'PLAN'; plan: ExecutionPlan }
  // Protocol B: request data
  | { type: 'NEED_DATA'; key: string; reason?: string };
```

### 5.2 Context Enrichment

Context is a dynamic container. Initially it contains only base file info. As the ping-pong interaction continues, the context is gradually enriched with asynchronously fetched data.

```ts
interface MicroContext {
  file: FileState;
  options: ApplyOptions;
  // Dynamic data container
  data: {
    remote_lock?: LockStatus;
    user_quota?: QuotaInfo;
    git_history?: CommitInfo;
    [key: string]: any;
  };
}
```

### 5.3 Micro Orchestrator

This is a `while` loop that runs inside the APPLY phase. Its job is to satisfy the DSL's declared dependencies.

```text
sequenceDiagram
  participant MO as Micro Orchestrator
  participant DSL as DSL Engine (Sync)
  participant SVC as Async Services

  loop until PLAN is produced
    MO->>DSL: 1. run strategy (pass Context)
    alt missing data
      DSL-->>MO: 2. return NEED_DATA('remote_lock')
      MO->>SVC: 3. await LockService.check()
      SVC-->>MO: 4. return LockStatus
      MO->>MO: 5. update Context.data.remote_lock
    else decision complete
      DSL-->>MO: 6. return PLAN
    end
  end
```

---

## 6. Reference Implementation

### 6.1 Macro Layer: SalmonLoop Flow (`flows/SalmonLoop.ts`)

```ts
import { Pipeline } from '../core/pipeline';
import { runPreflight, buildContext, generatePlan, runApply } from '../steps';

export async function executeSalmonLoop(options: GlobalOptions) {
  // Pipeline.of initializes the type as InitCtx
  const report = await Pipeline.of({ options })
    // Step 1: Preflight (pure async)
    // Automatically records startTime, duration, status
    .step('PREFLIGHT', runPreflight)
    // Step 2: Context discovery
    // Input type is inferred as PreflightCtx
    .step('CONTEXT', buildContext)
    // ... Step 3, 4, 5 ...
    // Step 6: Apply phase (junction of macro and micro)
    .step('APPLY', runApply)
    .execute();

  return report;
}
```

### 6.2 Bridge Layer: Apply Step (`steps/runApply.ts`)

```ts
export const runApply = async (ctx: ValidateCtx): Promise<ApplyCtx> => {
  const results = [];
  const orchestrator = new MicroOrchestrator();

  for (const file of ctx.diff.files) {
    // 1. Prepare micro context
    const microCtx = { file, options: ctx.options, data: {} };

    // 2. Run micro orchestration (ping-pong loop)
    // Load StandardStrategy here
    const plan = await orchestrator.decide(microCtx, StandardStrategy);

    // 3. Execute the plan produced by the DSL
    // NOTE: this is where side effects happen
    const result = await new Executor().execute(plan);
    results.push(result);
  }

  return { ...ctx, applyResults: results };
};
```

### 6.3 Micro Layer: DSL Strategy (`strategies/StandardStrategy.ts`)

```ts
import { DecisionEngine } from '../core/dsl';

export const StandardStrategy = (engine: DecisionEngine) => {
  return engine
    // Phase 1: Safety checks
    .phase('Security')
    .when((c) => c.file.isSymlink, (p) => p.reject('Symlink detected'))
    // Phase 2: External dependency checks (triggers async bridge)
    .phase('Lock Check')
    .requireData('remote_lock') // abort here if ctx.data.remote_lock is missing
    .when((c) => c.data.remote_lock.isLocked, (p) => p.reject('File locked by user'))
    // Phase 3: Routing
    .phase('Routing')
    .when((c) => c.file.isBinary, (p) => p.setWorker('overwrite-binary'))
    .when((c) => c.file.status === 'MM', (p) => p.setWorker('3way-merge'))
    // Default fallback
    .setWorker('direct-write');
};
```

---

## 7. Anti-Patterns

### Anti-Pattern 1: Using the DSL to orchestrate phases

Bad: attempting to orchestrate macro stages with the DSL.

```ts
// Forbidden.
strategy.phase('PREFLIGHT').action(async (c) => await git.status());
```

Impact: loss of type checking, hard-to-control promise chains, and poor debuggability.

### Anti-Pattern 2: Implicit async inside the DSL

Bad: calling async functions inside `when`.

```ts
// Forbidden.
.when(async (c) => await checkLock(c), ...);
```

Impact: the DSL engine becomes async, spreading async contamination, creating race conditions, and making pauses/resumes ambiguous.

### Anti-Pattern 3: God Context

Bad: defining a `TransactionContext` with every field optional.

```ts
interface Context {
  plan?: Plan; // optional? present or not?
  diff?: Diff; // optional?
  // ... 50 optional fields
}
```

Impact: type-system collapse, widespread `as any`, and fragile code.

---

## 8. Migration Guide

Use the Strangler Fig pattern for incremental refactoring:

1. Infrastructure preparation:
   - Introduce the `Pipeline` class.
   - Define per-phase context interfaces (`InitCtx`, `PreflightCtx`, etc.).
2. Macro layer extraction:
   - Keep the existing `TransactionStrategy` as-is.
   - Add `flows/SalmonLoopV3.ts`.
   - Extract `PREFLIGHT` logic from the DSL into `steps/preflight.ts`.
   - Call the extracted step from the v3 flow.
3. Micro layer slimming:
   - Once macro extraction is complete, the legacy DSL should only contain APPLY-level logic.
   - Remove all support for `async action` inside the DSL engine.
   - Introduce `MicroOrchestrator` and the `requireData` mechanism.
4. Switch-over:
   - Update the entrypoint to point to `SalmonLoopV3.ts`.
   - Deprecate the v1 DSL engine.

---

## 9. Appendix: Pain-Point Mapping

| v1 Pain Point | v3 Solution | Mechanism |
| --- | --- | --- |
| Async blocks everything | Layered governance | Macro uses Pipeline (native async); micro uses Bridge (sync-async decoupling). |
| Orchestration/decision mismatch | Dual engines | Pipeline runs linear workflow; DSL handles branching rules. |
| Type system collapse | Progressive context | Generic type inference across pipeline steps removes optional fields and `any`. |
| Workers do too much | Single responsibility | Steps handle I/O and computation; DSL only selects workers. |
| Nested callback hell | Flattened pipeline | Pipeline enforces a flat structure and discourages deep nesting. |

---
