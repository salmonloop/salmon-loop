# Extension configuration

SalmonLoop supports external capabilities through JSON config files under `.salmonloop/config` and `~/.salmonloop/config`.

## Config files by scope

| Scope | Path | Purpose |
| --- | --- | --- |
| Repository | `.salmonloop/config/mcp.json` | MCP v2 servers |
| Repository | `.salmonloop/config/tools.json` | Local JS plugins |
| Repository | `.salmonloop/config/skills.json` | Extra skill discovery paths |
| User | `~/.salmonloop/config/mcp-user.json` | User MCP v2 servers |
| User | `~/.salmonloop/config/tools-user.json` | User plugins |
| User | `~/.salmonloop/config/skills-user.json` | User skill discovery paths |

Repo entries override user entries.

## MCP v2 configuration

MCP uses `version: 2`. Legacy v1 MCP config is intentionally rejected.

```json
{
  "version": 2,
  "servers": {
    "local_docs": {
      "enabled": true,
      "transport": {
        "type": "stdio",
        "command": "node",
        "args": ["./scripts/docs-mcp.js"],
        "env": {
          "DOCS_TOKEN": "local-token"
        },
        "cwd": "."
      },
      "auth": { "type": "none", "scopes": [] },
      "trust": "local",
      "capabilities": {
        "tools": {
          "exposeToModel": true,
          "allow": ["read_*", "search"],
          "phases": ["CONTEXT", "PLAN"],
          "approval": "never"
        },
        "resources": {
          "allowUris": ["file:///repo/docs/*"],
          "autoInclude": false,
          "subscribe": false,
          "maxBytes": 64000,
          "ttlMs": 30000
        },
        "prompts": {
          "exposeAs": "slash",
          "allow": ["review"]
        },
        "roots": { "mode": "repo" },
        "sampling": { "enabled": false, "maxTokens": 0, "maxDepth": 0 },
        "elicitation": { "enabled": false }
      }
    },
    "remote_status": {
      "enabled": true,
      "transport": {
        "type": "http",
        "url": "https://example.com/mcp",
        "headers": { "Authorization": "Bearer token" }
      },
      "auth": { "type": "oauth", "scopes": ["mcp.read"] },
      "trust": "remote",
      "capabilities": {
        "tools": {
          "exposeToModel": true,
          "allow": ["status"],
          "phases": ["VERIFY"],
          "approval": "ask"
        }
      }
    }
  }
}
```

Important contract details:

- `transport` is explicit: `{ "type": "stdio", ... }` or `{ "type": "http", ... }`.
- Stdio `transport.env` is required and exact. SalmonLoop does not inherit `process.env` into MCP servers.
- All capability groups default to deny/off. A server with no `capabilities.tools.exposeToModel` and `capabilities.tools.allow` exposes no model tools.
- Tool phases come from `capabilities.tools.phases`; MCP tools are not automatically limited to `VERIFY`.
- `resources`, `prompts`, `roots`, `sampling`, and `elicitation` are separate grants, not tool allowlist side effects.
- `ToolSpec` is a SalmonLoop bridge target only. MCP's native catalog remains under `src/core/mcp`.

## Skills configuration

Skills follow the [AgentSkills](https://agentskills.io/specification) directory convention:

```text
.salmonloop/skills/
  my-skill/
    SKILL.md
```

Only `skill-name/SKILL.md` is supported.

### Skills config file

```json
{
  "version": 1,
  "discovery": {
    "paths": ["./.salmonloop/skills"]
  }
}
```

- `paths` can include repo-relative directories.
- Absolute paths are allowed only in user-level config.
- Repo-scoped paths resolving outside repo root are rejected.
- Duplicate skill names are resolved by first-win priority with warning logs.

### Skill discovery priority

| Priority | Path | Scope |
|----------|------|-------|
| 1 | Config extra paths (`skills.json` `discovery.paths`) | config |
| 2 | `{repoRoot}/.salmonloop/skills` | repo |
| 3 | `{repoRoot}/.agents/skills` | repo |
| 4 | `~/.salmonloop/skills` | user |
| 5 | `~/.agents/skills` | user |

The `.agents/skills` paths provide cross-client interoperability with AgentSkills tools.

## Supported MCP transports

- Stdio (`transport.type: "stdio"`)
- Streamable HTTP (`transport.type: "http"`)

## Tips

- Keep `.salmonloop/` gitignored for local-only config.
- Re-run commands after config edits so the toolstack reloads settings.
