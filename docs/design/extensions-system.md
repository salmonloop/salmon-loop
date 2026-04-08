# Extensions resolution system

SalmonLoop resolves MCP servers, tool plugins, and skills into a single `ResolvedExtensions` view.

## Configuration and precedence

- `.salmonloop/config/mcp.json` and `~/.salmonloop/config/mcp-user.json`
- `.salmonloop/config/tools.json` and `~/.salmonloop/config/tools-user.json`
- `.salmonloop/config/skills.json` and `~/.salmonloop/config/skills-user.json`

Resolution is user-first then repo-override.

## Skill discovery behavior

Skills use strict AgentSkills layout:

```
skills-root/
  my-skill/
    SKILL.md
```

Only `skill-name/SKILL.md` is accepted.

Discovery priority:
1. config `discovery.paths`
2. `{repoRoot}/.salmonloop/skills`
3. `{repoRoot}/.agents/skills`
4. `~/.salmonloop/skills`
5. `~/.agents/skills`

## Loader contract

`SkillLoader` accepts `{ repoRoot, extraPaths?: string[] }`.

- Tier 1: `loadCatalog()` loads lightweight metadata.
- Tier 2: `activateSkill(id)` loads full skill content on demand.

## Strict frontmatter parsing

`SkillFrontmatterSchema` enforces:
- required `name` and `description`,
- optional spec fields (`license`, `compatibility`, `metadata`, `allowed-tools`),
- unknown field rejection,
- name-directory match.

## Toolstack integration

- skills are registered via `skillToToolSpec(...)`,
- execution always goes through `executeSkill()` and governed `ToolRouter`,
- bridge execution can be disabled by `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC`.
