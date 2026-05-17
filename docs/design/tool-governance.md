# SalmonLoop Tool Calling Executable Specification (v1)

## 1. Core Objective
Establish a **stable, controllable, replayable, and extensible** tool calling system; thoroughly eliminate the confusion between "descriptive calls" and "actual execution".

> **Guiding Principle**: Tool Calling is a protocol, not a conversational technique. Any ambiguity must converge to "non-executable".

---

## 2. System Prompt Structure (Strict)
Tool definitions must and can only appear at the very beginning of the **System / Runtime Contract**, serving as immutable "legal text".

```text
SYSTEM
├─ Runtime Contract (Protocol/Legal Text)
│  ├─ Tool Definitions (Capabilities + Simplified Schema)
│  └─ Tool Calling Rules (Unique Executable Format)
├─ Task / User Instruction (Dynamic)
└─ Notes / Examples (Explicitly marked as NOT EXECUTE)
```

---

## 3. Tool Definition (External API)
### 3.1 Naming Convention
Tool names are part of the model-visible API. They must be stable,
predictable, and chosen to reduce tool-selection hallucinations. This section
is the naming SSOT for all new tools.

**Canonical format for built-in model-visible tools**:

```text
domain.operation[.qualifier]
```

Examples: `code.search`, `fs.read`, `git.status`, `plan.update`.

Hard syntax rules:

- Use lowercase ASCII only.
- Separate namespace segments with `.`.
- Use at most three segments: `domain.operation` or
  `domain.operation.qualifier`.
- Each segment must start with a letter and then use only letters, numbers, or
  `_`.
- `operation` may be a single common action (`read`, `list`, `search`,
  `status`, `apply`, `run`, `write`, `submit`, `report`) or a concrete
  verb-object operation (`write_file`, `ask_user`, `diff_check`,
  `load_instance`).
- Do not use single-token or snake_case-only names for new built-ins.
- Do not encode implementation source in a built-in tool name. `source:
  "builtin"` is runtime metadata, not part of the model-facing name.

Semantic review rules:

- Use one domain per product concept: `fs`, `git`, `code`, `test`, `plan`,
  `artifact`, `proposal`, `interaction`, `shell`, `benchmark`, `swebench`.
- Keep names concrete. Prefer `git.status` and `test.run` over generic names
  such as `inspect`, `process`, `handle`, `health`, or `quality_gate`.
- Prefer a verb the model already associates with software work. If the
  operation needs an object, use `verb_object` rather than inventing an abstract
  noun.
- Keep user-facing aliases, audit events, allowlists, and prompt examples on
  the same canonical name. If a provider-native adapter requires a different
  function name shape, the adapter must perform a reversible alias mapping and
  map every result back to the canonical SalmonLoop name before registry lookup,
  authorization, audit logging, and session persistence.

Examples (filesystem):
- Read-only: `fs.read`, `fs.list`, `fs.list_directory`, `fs.list_files`
- Write (slash-only): `fs.write_file`, `fs.create_directory`, `fs.delete_file`

External and legacy namespaces:

- MCP tools are exposed as `mcp.<server>.<tool>` to avoid collisions across
  servers. The server and tool segments must be allowlisted by configuration.
- Plugin tools are exposed as `plugin.<pluginId>.<tool>` for the same collision
  reason. Plugin authors should still use canonical names inside their plugin
  API, e.g. `search` or `report`, and let the loader prefix them.

Grandfathered built-in names:

- `agent_dispatch`
- `update_knowledge`

These two names are retained for compatibility only. They must not be used as
precedent for new built-ins.

Benchmark and quality tools must use the same canonical form. Approved names
for the benchmark-quality work are:

- `git.diff_check`
- `git.apply_check`
- `test.run`
- `benchmark.report`
- `swebench.load_instance`
- `swebench.write_prediction`
- `swebench.submit_predictions`
- `swebench.get_report`

Avoid these names:

- `patch_health` — abstract and not tied to a concrete system domain.
- `quality_gate` — implies a stop-gate policy rather than a model-callable
  diagnostic tool.
- `bench_export` — ambiguous object and non-canonical abbreviation.
- `swe_smoke` — unstable abbreviation.
- `validate_patch` — ambiguous with schema validation and apply validation.

These rules intentionally align with common agent/tool ecosystems:
OpenAI-style function names are short and action-oriented; Anthropic-style tool
definitions rely on clear names and precise descriptions; MCP must tolerate
multi-server tool aggregation. SalmonLoop uses dotted namespaces internally
because the existing public tool API already does so, while preserving the same
industry principles: clear domain, concrete operation, conservative character
set, and no implementation leakage.

### 3.2 ToolSpec (Strongly Typed)
```typescript
interface ToolSpec<I, O> {
  name: string;
  source: "builtin" | "mcp" | "plugin"; // Internal use only, invisible to Agent
  description: string;
  riskLevel: "low" | "medium" | "high";
  sideEffects: SideEffect[]; // ["fs_read", "fs_write", "process", ...]
  allowedPhases: ExecutionPhase[]; // ["CONTEXT", "SHRINK"]
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  executor: (input: I, ctx: ToolRuntimeCtx) => Promise<O>;
}
```

---

## 4. Prompt Display Schema (LLM Friendly)
To avoid excessive prompt length, do not use raw Zod objects or `zod-to-json-schema`. Instead, extract a **minimal set**:

```typescript
type PromptParam = {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  enum?: string[];
  description?: string;
};
```
*   **Runtime**: Use Zod for strict validation.
*   **Prompt**: Use simplified Schema for display.
*   **Future Extension**: Enable full JSON Schema when integrating with OpenAI/Anthropic native Function Calling.

---

## 5. Unique Executable Tool Call Protocol
Only the following format is supported. **Any character deviation results in non-execution**:

```xml
<sl_tool_call v="1">
{"id":"tc_001","toolName":"code.search","args":{"pattern":"BudgetGuard","glob":"src/**/*.ts"}}
</sl_tool_call>
```

### Hard Rules
1.  **Strict Tag Matching**: Must be `<sl_tool_call v="1">`.
2.  **Content Restriction**: Inside must be **single-line**, **standard JSON**.
3.  **Context Isolation**: Tags appearing inside Markdown code blocks (```) are treated as text and **will not be executed**.
4.  **Exclusivity**: Detecting Claude DSL (e.g., `<call:default_api:...>`) or other formats will directly trigger `UNSUPPORTED_TOOL_PROTOCOL`.

---

## 6. Parser Specification (No Tolerance)
The parser must be extremely strict and refuse to guess:
1.  **Regex Matching**: Only matches top-level `<sl_tool_call v="1">`.
2.  **JSON Parsing**: Failure throws `PARSE_ERROR`.
3.  **Name Validation**: If `toolName` is not in Registry, throw `TOOL_NOT_FOUND`.
4.  **Protocol Guard**: Detecting `<call:...>` and other illegal protocols throws `UNSUPPORTED_TOOL_PROTOCOL`.

---

## 7. ToolRouter Single Exit (Fixed Execution Chain)
All tool calls must pass through the following pipeline:
1.  **Registry Resolve**: Lookup tool definition.
2.  **Audit Start**: Record call intent.
3.  **Input Validation**: Validate parameters using Zod Schema.
4.  **Policy Gate**: Check `ExecutionPhase`, `SideEffects`, and allowlist.
5.  **Budget Gate**: Check concurrency, timeout settings, and output size limits.
6.  **Execute**: Execution logic (including Capability/Backend multi-backend fallback).
7.  **Output Validation**: Validate output structure.
8.  **Sanitize**: Result sanitization and summary truncation.
9.  **Audit End**: Record final status (including `backend` source).
10. **Return**: Return standard `ToolResult`.

---

## 8. Discovery Loop (State Machine)
Uses a "Tool Turn" system, does not force explicit ReAct (Thought-Action-Observation) text output.

*   **Logic**: Max **1** tool call per turn, or zero (directly produce conclusion).
*   **Limit**: `maxDiscoveryTurns = 8~12`.
*   **Early Stop Conditions**:
    *   Obtained "Position Confirmation Declaration".
    *   Two consecutive `InsufficientCoverage` or `AmbiguousResult`.
    *   Reached Budget threshold.

---

## 9. Error Code Standard
All tool execution errors must map to the following structured codes:
*   `PARSE_ERROR`: Format error.
*   `TOOL_NOT_FOUND`: Tool does not exist.
*   `INVALID_INPUT`: Parameters do not match Schema.
*   `DENIED_BY_POLICY`: Violation of phase or security policy.
*   `TIMEOUT`: Execution timed out.
*   `EXEC_ERROR`: Runtime exception.
*   `UNSUPPORTED_TOOL_PROTOCOL`: Illegal protocol format used.

---

## 10. Log Specification
Logs should clearly reflect the call source and status:
*   `Tool execution [code.search] (source=builtin): ok`
*   `Tool execution [code.read_file] (source=builtin): denied (phase=APPLY)`
*   `Tool execution [code.search] (source=builtin): ok (backend=rg→powershell)`

---

## 11. Testing Hard Requirements (Bun Test)
*   **Environment Isolation**: Must use `useFakeTimers()`, Mock `process.nextTick`.
*   **No Side Effects**: Ban real disk I/O, network requests, and child process spawning (except in integration tests).
*   **Mandatory Test Scenarios**:
    *   "Fake calls" in descriptive text are not executed.
    *   Tags inside code blocks are not executed.
    *   Illegal protocol formats trigger `UNSUPPORTED_TOOL_PROTOCOL`.
    *   Phase Deny works effectively.
    *   Backend Fallback mechanism works effectively.
    *   Audit logs are recorded completely.

---

## 12. Three-Layer Execution Model (v1.1)

To manage complexity, all executables are classified into a three-layer triage:

1. **Layer 1: Simple Tools**: Pure functions, synchronous/atomic side effects. Low overhead.
2. **Layer 2: Micro Tasks**: DSL-driven logic (Grizzco). Uses `MicroTaskRunner` for data resolution.
3. **Layer 3: Sub-Agents**: LLM-driven autonomous loops. Handles probabilistic outcomes.

*Protocol Requirement*: All layers must implement the `IExecutable` interface defined in `src/core/skills/types.ts`.
