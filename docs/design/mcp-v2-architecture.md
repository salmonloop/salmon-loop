# MCP v2 Architecture

## Contract

MCP is a first-class runtime domain under `src/core/mcp`. It is not a submodule of `src/core/tools`, and `ToolSpec` is not the MCP schema. `ToolSpec` is only the final bridge artifact used to expose selected MCP tools to SalmonLoop's existing tool governance.

No MCP v1 config compatibility is supported. Config must use `version: 2`; legacy flattened fields such as `command`, `url`, `allow.tools`, `allowTools`, or `allowResources` are invalid.

## Domain Boundaries

`src/core/mcp` owns:

- config schema and resolution,
- MCP transport creation and lifecycle,
- catalog discovery for tools, resources, resource templates, and prompts,
- capability grants and policy decisions,
- resource context inclusion,
- prompt command/recipe exposure,
- roots, sampling, and elicitation host surfaces,
- observability event payloads,
- bridge conversion from MCP descriptors to SalmonLoop `ToolSpec`.

`src/core/tools` owns only the generic SalmonLoop tool registry, router, budget, audit, sanitization, and execution policy. It may consume bridged MCP `ToolSpec` values, but it must not define MCP protocol types, clients, loaders, or schemas.

## Config Shape

Each server uses an explicit transport object:

```json
{
  "version": 2,
  "servers": {
    "docs": {
      "transport": {
        "type": "stdio",
        "command": "node",
        "args": ["server.js"],
        "env": {}
      },
      "auth": { "type": "none", "scopes": [] },
      "trust": "local",
      "capabilities": {
        "tools": {
          "exposeToModel": true,
          "allow": ["read_*"],
          "phases": ["CONTEXT"],
          "approval": "never"
        }
      }
    }
  }
}
```

All capability groups default to deny/off:

- `tools`: model exposure, name allowlist, phases, approval mode, side-effect overrides.
- `resources`: URI grants, auto-include, subscriptions, read budget, TTL.
- `prompts`: slash/recipe exposure and prompt allowlist.
- `roots`: host root exposure mode.
- `sampling`: model-calling permission and limits.
- `elicitation`: user-input request permission.

## Security Invariants

- Stdio MCP processes receive exactly `transport.env`; host `process.env` is not inherited.
- HTTP MCP servers default to `trust: "remote"`; stdio defaults to `trust: "local"`.
- Remote trust raises tool risk.
- Tool registration is separate from tool execution. `ask` outcomes remain registered so SalmonLoop's authorization layer can request approval at execution time.
- Resource reads are URI-policy gated before any read occurs.
- Sampling is denied by default. Elicitation asks by default.
- The toolstack owns a long-lived `McpConnectionManager` and must call `dispose()` when the attempt/session ends.

## Runtime Flow

1. Extension resolution parses MCP v2 config and produces `ResolvedMcpServerV2`.
2. `createStandardToolstack()` builds one `McpConnectionManager` for enabled servers.
3. Catalog discovery captures tools, resources, resource templates, and prompts.
4. `buildMcpGrantsFromCapabilities()` turns server capabilities into policy grants.
5. `registerMcpV2Tools()` bridges allowed MCP tool descriptors into `ToolSpec`.
6. The normal SalmonLoop `ToolRouter` handles phase policy, permission rules, authorization, budget, execution, output validation, and audit.
7. `toolstack.dispose()` closes MCP transports and terminates HTTP sessions when supported.

## ACP Session Servers

ACP `mcpServers` are normalized into the same `ResolvedMcpServerV2` shape. Session-provided stdio/http servers get tool exposure for `VERIFY` by default and no resource/prompt/root/sampling/elicitation grants unless explicitly modeled later.

Unsupported ACP MCP transports (`sse`, `acp`) remain rejected.

## Non-Goals

- No compatibility layer for MCP v1 config.
- No automatic conversion of all MCP capabilities into model tools.
- No `src/core/tools/mcp` runtime path.
- No hidden environment inheritance for stdio MCP servers.
