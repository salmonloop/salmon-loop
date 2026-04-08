# Extension configuration

SalmonLoop supports external capabilities through JSON config files under `.salmonloop/config` and `~/.salmonloop/config`.

## Config files by scope

| Scope | Path | Purpose |
| --- | --- | --- |
| Repository | `.salmonloop/config/mcp.json` | MCP servers |
| Repository | `.salmonloop/config/tools.json` | Local JS plugins |
| Repository | `.salmonloop/config/skills.json` | Extra skill discovery paths |
| User | `~/.salmonloop/config/mcp-user.json` | User MCP servers |
| User | `~/.salmonloop/config/tools-user.json` | User plugins |
| User | `~/.salmonloop/config/skills-user.json` | User skill discovery paths |

Repo entries override user entries.

## Skills configuration

Skills follow the [AgentSkills](https://agentskills.io/specification) directory convention:

```
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

## Supported MCP protocols

- Stdio (`command`)
- Streamable HTTP (`url`)

Both use MCP protocol version `2025-11-25`.

## Tips

- Keep `.salmonloop/` gitignored for local-only config.
- Re-run commands after config edits so the toolstack reloads settings.
