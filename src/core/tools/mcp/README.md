# MCP Tool Integration

This package exposes external Model Context Protocol servers as SalmonLoop tools.

Protocol transport and JSON-RPC behavior are delegated to the official
`@modelcontextprotocol/sdk` package:

- `Client` owns initialization, request IDs, notifications, and request timeouts.
- `StdioClientTransport` owns process stdio framing.
- `StreamableHTTPClientTransport` owns Streamable HTTP, SSE, session IDs, and cleanup.

The local code stays intentionally thin. `client.ts` maps SalmonLoop MCP config to
an SDK transport and forwards `listTools` and `callTool`. `loader.ts` maps discovered
MCP tools into SalmonLoop's `ToolRegistry`.

## Supported Transports

- `stdio`: `command`, optional `args`, `env`, and `cwd`
- `http`: `url` and optional `headers`

Stdio stderr is always piped and drained so MCP server diagnostics do not write raw
content to the parent TTY.

## Tool Governance

Each registered MCP tool keeps SalmonLoop's local policy surface:

- Name: `mcp.<server>.<tool>`
- Source: `mcp`
- Intent: `INFRA`
- Risk level: `medium`
- Side effects: `process`, `network`
- Allowed phases: `VERIFY` only
- Concurrency: `serial_only`
- Default timeout: `LIMITS.defaultToolTimeoutMs`

`allow.tools` is mandatory. Servers without an allowlist are skipped, and only
allowlisted tools are registered. Server and tool name segments must contain only
letters, numbers, `_`, and `-` so the model-visible tool namespace stays predictable.
