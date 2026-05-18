# Tool loading guide

The `src/core/tools` subtree contains the components that register and execute tools within the SalmonLoop runtime.

Key points for internal contributors:

- `loader.ts` now accepts an optional `extensions?: ResolvedExtensions` payload (see `src/core/extensions`). It boots the skill loader, then wires in `registerMcpTools` and `registerPluginTools` so the tool registry sees the same extensions that were resolved by the CLI and preflight steps.
- `mcp/loader.ts` lives under `src/core/tools/mcp`. Its job is to start each enabled MCP server, run `tools/list`, and register safe tool specs such as `mcp.<server>.<tool>`. Each tool is restricted to the `VERIFY` phase, tagged with `process`/`network` side effects, and namespaced for audit logging; `allow.tools` is required to avoid accidental exposure.
- `plugins/loader.ts` lives under `src/core/tools/plugins`. It imports configured plugin modules, calls their `register()` hook, validates the returned `ToolSpec[]`, and renames every tool to `plugin.<pluginId>.<toolName>` to keep names stable for authorization history. Side effects and allowed phases are enforced before registration.
- `skillToToolSpec` pulls skill metadata from `src/core/skills`. `SkillLoader` now receives explicit discovery paths and repo root so it works in worktree/resolved contexts.

## Tool calling loops (execution)

Tool execution is orchestrated by `src/core/tools/session.ts`:

- `chatWithTools(...)`: round-based non-streaming loop.
- `chatWithToolsStreaming(...)`: streaming variant that assembles assistant content + tool calls from `LLM.chatStream(...)`.

Design notes:

- Budgeting: tool execution is constrained by per-session budgets and enforced inside `executeToolCalls(...)`. `maxToolCallsTotal` / `maxToolCallsPerRound` apply to regular tools, while `maxAgentToolCallsTotal` / `maxAgentToolCallsPerRound` apply to AGENT-intent delegation tools. The buckets are independent so ordinary exploration cannot accidentally starve deliberate sub-agent delegation, and callers can still clamp either bucket explicitly.
- Determinism: tool calls are executed through the parallel scheduler (`src/core/tools/parallel`), which supports blocked approvals and deterministic resumption.
- Two tool timelines:
  - Model request timeline: when the model requests a function call (canonical responses events).
  - Host execution timeline: when SalmonLoop executes the tool (`tool.call.start` / `tool.call.end`).

For headless/UI adapters, the model request timeline is emitted as canonical responses events on the loop bus:

- `type: "llm.responses.event"` with OpenAI-like event objects.
- Default redaction applies: tool arguments are not emitted unless explicitly enabled.

If you extend or refactor tool registration, update this README so future maintainers can quickly understand how MCPs, plugins, and skills join the registry.
