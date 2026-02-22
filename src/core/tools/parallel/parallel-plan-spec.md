# Parallel Plan DSL Specification (v1.0)

## 1. Introduction
Parallel Plan DSL (PPD) is the tactical intermediate representation for SalmonLoop's parallel execution kernel. It decouples agentic logic from physical execution constraints like resource locking and concurrency control. Unlike the high-level Grizzco DSL which orchestrates agent phases (Strategic Layer), PPD focuses on the atomic orchestration of tool calls (Tactical Layer).

## 2. Core Concepts
- **Execution Graph (DAG)**: A directed acyclic graph where nodes are tool calls and edges are dependencies.
- **Lane Model**:
  - **ReadLane**: High-performance concurrent execution for `parallel_ok` tools (e.g., `fs.read`, `code.search`).
  - **WriteLane**: Strict serialization for state-mutating tools (e.g., `fs.write`, `test.run`).
- **Node Lifecycle**: `PENDING -> READY -> RUNNING -> SUCCEEDED | FAILED | CANCELED | BLOCKED_APPROVAL`.

## 2.1 Relationship with Grizzco
Grizzco DSL outputs its own `ExecutionPlan` for strategic decisions. That plan is **not** the PPD plan. The Grizzco plan must be translated into a PPD `ExecutionPlan` before parallel execution.

## 3. DSL Schema
### ExecutionPlan
The root object describing the entire task graph.
- `id`: Unique trace identifier.
- `nodes`: Array of `PlanNode`.
- `policy`: Concurrency and failure strategies (e.g., `maxParallelism`, `failFast`).

### PlanNode
An individual unit of execution.
- `id`: Unique node identifier (e.g., `node-0`).
- `toolName`: The registry name of the tool.
- `args`: Input arguments (may contain `OutputRef`).
- `deps`: List of IDs this node depends on.

## 4. Syntax & Builder API
The `PlanBuilder` class provides a fluent interface for constructing plans:
- `addNode(tool, args, id?)`: Adds a tool call to the graph.
- `depends(on, next)`: Creates a dependency edge.
- `parallel(ids[])`: Convenience method for independent nodes.
- `serial(ids[])`: Convenience method for sequential node chains.

## 5. Data Flow (OutputRef)
Nodes reference outputs of successful predecessors using JSON-path placeholders:
- **Full Reference**: `{ $ref: 'nodeOutput', nodeId: 'n1' }`
- **Path Reference**: `{ $ref: 'nodeOutputPath', nodeId: 'n1', path: 'a.b[0].c' }`

Resolution happens JIT (Just-In-Time) by the `ParallelScheduler` right before a node enters the `RUNNING` state:
- `OutputRef` arguments are resolved from completed node results.
- `ToolSpec` is resolved from the tool registry if it is not already attached to the node.
- `computeResources` is invoked (when available) on resolved arguments. If it is missing, default resources are derived from `sideEffects` to preserve safety.

## 6. Execution & Safety Protocol
- **Metadata-Driven Locking**: Locks are NOT declared in the DSL; they are derived from tool metadata (`computeResources`) at runtime based on resolved arguments.
- **Deadlock Prevention**: The `LockManager` enforces **Alphabetical Sort** on all resource keys before acquisition.
- **Physical Isolation**: Tools marked as `isolated` (e.g., `test.run`) trigger the `IsolationManager` to create temporary Git indices and workspaces.

## 7. Typical Pattern (Scout-Analyst-Fixer)
```typescript
const pb = new PlanBuilder();

// 1. Parallel Reads (Scout)
const r1 = pb.addNode("fs.read", { file: "src/app.ts" });
const r2 = pb.addNode("code.search", { query: "export class" });
pb.parallel([r1, r2]);

// 2. Generation (Analyst)
const gen = pb.addNode("llm.patch", {
  context: [pb.ref(r1), pb.ref(r2)]
});
pb.depends(r1, gen);
pb.depends(r2, gen);

// 3. Serial Write (Fixer)
const write = pb.addNode("fs.write", {
  file: "src/app.ts",
  content: pb.refPath(gen, "patch")
});
pb.depends(gen, write);

// 4. Isolated Verify
const test = pb.addNode("test.run", { command: "project-test-command" });
pb.depends(write, test);

return pb.build({ maxParallelism: 8 });
```
