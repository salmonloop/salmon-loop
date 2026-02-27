# Extension configuration

SalmonLoop lets you add non-builtin capabilities (MCP servers, local tool plugins, and skill directories) by writing JSON files under `.salmonloop/config` or `~/.salmonloop/config`. This doc explains the file names, scopes, and the `ResolvedExtensions` view that the runtime consumes.

## Config files by scope

| Scope | Path | Purpose |
| --- | --- | --- |
| Repository | `.salmonloop/config/mcp.json` | MCP servers (stdio via `command` or streamable via `url`). |
| Repository | `.salmonloop/config/tools.json` | Local JS plugin definitions (`path`, `enabled`, `allowUserScope`). |
| Repository | `.salmonloop/config/skills.json` | Additional skill discovery paths, whether to keep compatibility defaults. |
| User | `~/.salmonloop/config/mcp-user.json` | Same fields as repo MCP config, default `enabled: false`. |
| User | `~/.salmonloop/config/tools-user.json` | Plugin definitions that live under the user home. |
| User | `~/.salmonloop/config/skills-user.json` | User-specific skill discovery paths. |

Entries merge with the policy “user first, repo overrides.” Repo files can disable a user entry by setting `enabled: false`.

## MCP samples

### Stdio MCP (local process)

```json
{
  "version": 1,
  "servers": {
    "files": {
      "enabled": true,
      "command": "node",
      "args": ["./scripts/mcp-files-server.js"],
      "env": {
        "NODE_ENV": "production"
      },
      "allow": {
        "tools": ["readFile", "listDir"]
      }
    }
  }
}
```

- `allow.tools` is mandatory — the MCP loader registers only allow-listed tools. Patterns ending with `*` work (`"read*"`).
- If you omit `enabled`, repo entries default to `true`, user entries default to `false`.
- Be cautious with `env`; secrets are redacted whenever the CLI prints the resolved extensions.

### Streamable HTTP MCP (remote)

```json
{
  "version": 1,
  "servers": {
    "remote": {
      "enabled": true,
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer $TOKEN"
      },
      "allow": {
        "tools": ["*"]
      }
    }
  }
}
```

- Exactly one of `command` or `url` is required per server entry.
- `url` indicates a **Streamable HTTP** connection, where JSON-RPC messages are exchanged over a streaming response.
- `headers` are sent with every request (POST/GET/DELETE) for Streamable HTTP connections.

## Tool plugin sample

```json
{
  "version": 1,
  "plugins": {
    "acme": {
      "enabled": true,
      "path": "./.salmonloop/plugins/acme/index.js"
    }
  }
}
```

- Each plugin module must export `pluginId` (string) and `register(): ToolSpec[]`.
- Plugins must declare `sideEffects` and `allowedPhases`; tools that touch `PLAN`/`PATCH`/`APPLY` are rejected.
- The loader renames tools to `plugin.<pluginId>.<toolName>` for consistent governance.
- User-scoped plugins require `"allowUserScope": true` if you want to enable them.

## Skills configuration

```json
{
  "version": 1,
  "discovery": {
    "useDefaults": true,
    "paths": ["./.salmonloop/skills"]
  }
}
```

- `paths` can include absolute or repo-relative directories. Any duplicated skill IDs log a warning and are ignored.
- `useDefaults` keeps compatibility paths such as `~/.salmonloop/skills`, `~/.claude/skills`, and `<repo>/.claude/skills`.
- You can mix repo and user discovery files; repo wins on conflicts.

## Peeking at `ResolvedExtensions`

Run `s8p run --print-config` (or the upcoming `s8p config print --effective`) to see what SalmonLoop has loaded. The `extensions` section shows `mcpServers`, `toolPlugins`, and `skillDiscovery`; secrets in `env` are redacted (`<redacted>`).

## Supported MCP Protocols

SalmonLoop supports two MCP transport types for connecting to external servers:

### Stdio (local process)

- **Transport**: Spawns a child process using the `command` field.
- **Configuration**: Optional `args` (array of arguments), `env` (environment variables), and `cwd` (working directory).
- **Communication**: JSON-RPC over stdin/stdout with newline-delimited messages.
- **Features**: Full JSON-RPC support including `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
- **Use case**: Local MCP servers running as Node.js, Python, or other executables.

### Streamable HTTP (remote)

- **Transport**: HTTP/HTTPS connection using the `url` field.
- **SSOT Strategy**: SalmonLoop treats "Streamable" as the single source of truth for all remote communications.
- **Communication**: JSON-RPC over a persistent HTTP POST connection. The server returns a continuous stream of response chunks.
- **Session management**: Handled via standard HTTP headers and correlation IDs within the JSON-RPC payload.
- **Features**: Same JSON-RPC operations as stdio, using standard streaming bodies to ensure high responsiveness and zero-latency tool updates.
- **Use case**: Remote MCP servers, cloud-hosted tools, or services requiring an elastic, streamable transport layer.

### Capabilities and constraints

- Both transports implement MCP protocol version `2025-11-25`.
- Tool discovery via `tools/list` is performed once per server during startup.
- Tool execution via `tools/call` creates a new client instance per invocation (for HTTP) to ensure clean session handling.
- MCP tools are always restricted to the `VERIFY` phase and tagged with `process` and `network` side effects.
- Tool names are namespaced as `mcp.<server>.<tool>` for consistent governance and audit logging.
- An explicit `allow.tools` list is required for each server; tools not on the list are not registered.

## Tips

- Keep `.salmonloop/` gitignored — it is intentionally local-only.
- After editing any extension file, rerun the CLI command so the toolstack picks up the latest entries.
- This system is future-proofed for explicit CLI commands (`config mcp add`, `config tools validate`, etc.) that will edit these JSON files for you; until those land, edit files directly and keep backups.
