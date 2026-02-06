# Tool loading guide

The `src/core/tools` subtree contains the components that register and execute tools within the SalmonLoop runtime.

Key points for internal contributors:

- `loader.ts` now accepts an optional `extensions?: ResolvedExtensions` payload (see `src/core/extensions`). It boots the skill loader, then wires in `registerMcpTools` and `registerPluginTools` so the tool registry sees the same extensions that were resolved by the CLI and preflight steps.
- `mcp/loader.ts` lives under `src/core/tools/mcp`. Its job is to start each enabled MCP server, run `tools/list`, and register safe tool specs such as `mcp.<server>.<tool>`. Each tool is restricted to the `VERIFY` phase, tagged with `process`/`network` side effects, and namespaced for audit logging; `allow.tools` is required to avoid accidental exposure.
- `plugins/loader.ts` lives under `src/core/tools/plugins`. It imports configured plugin modules, calls their `register()` hook, validates the returned `ToolSpec[]`, and renames every tool to `plugin.<pluginId>.<toolName>` to keep names stable for authorization history. Side effects and allowed phases are enforced before registration.
- `skillToToolSpec` pulls skill metadata from `src/core/skills`. `SkillLoader` now receives explicit discovery paths and repo root so it works in worktree/resolved contexts.

If you extend or refactor tool registration, update this README so future maintainers can quickly understand how MCPs, plugins, and skills join the registry.
