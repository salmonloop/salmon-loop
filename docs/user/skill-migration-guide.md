# Skill Migration Guide: Legacy `.md` → `SKILL.md` Subdirectory Format

SalmonLoop now follows the [AgentSkills](https://agentskills.io/specification) directory convention. Skills must live in a named subdirectory with an exact `SKILL.md` filename instead of a flat `.md` file under the skills root.

## What Changed

| Before (legacy) | After (canonical) |
| --- | --- |
| `skills/my-skill.md` | `skills/my-skill/SKILL.md` |

The loader **no longer reads** direct `.md` files by default. Only the `skill-name/SKILL.md` subdirectory pattern is scanned.

## Step-by-Step Conversion

For each legacy skill file:

```bash
# 1. Create the subdirectory (name must match the frontmatter `name` field)
mkdir -p .salmonloop/skills/my-skill

# 2. Move and rename the file
mv .salmonloop/skills/my-skill.md .salmonloop/skills/my-skill/SKILL.md
```

Repeat for every `.md` file under your skills roots. The same applies to user-level skills under `~/.salmonloop/skills/`.

### Frontmatter Requirements

Ensure each `SKILL.md` has valid YAML frontmatter with at least `name` and `description`:

```yaml
---
name: my-skill
description: A short description of what this skill does
---
```

The `name` field must:
- Be 1–64 characters
- Use only Unicode lowercase alphanumeric characters and hyphens (per [AgentSkills spec](https://agentskills.io/specification))
- Not start or end with a hyphen, and not contain consecutive hyphens (`--`)
- Match the parent directory name exactly (e.g., `my-skill/SKILL.md` → `name: my-skill`)

## Compatibility Mode During Transition

If you need time to migrate, enable the legacy format temporarily via the `legacyDirectMd` flag.

### Option A: Environment Variable

```bash
export SALMONLOOP_SKILL_LEGACY_DIRECT_MD=true
```

### Option B: Skills Config File

In `.salmonloop/config/skills.json` (repo-level) or `~/.salmonloop/config/skills-user.json` (user-level):

```json
{
  "version": 1,
  "discovery": {
    "useDefaults": true,
    "paths": [],
    "legacyDirectMd": true
  }
}
```

When compatibility mode is enabled, legacy `.md` files will load but emit a deprecation warning in the logs for each one.

## Feature Flags Reference

Three environment variables control the skills subsystem rollout:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SALMONLOOP_SKILL_PARSER_STRICT` | `true` | When `true`, name-directory mismatches are rejected. Set to `false` for warning-only mode. |
| `SALMONLOOP_SKILL_LEGACY_DIRECT_MD` | `false` | When `true`, the loader accepts legacy flat `.md` files (with deprecation warnings). |
| `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` | `true` (non-dev) | When `true`, disables the bridge (ToolRegistry) skill execution path entirely. |

All three accept `true`/`1` to enable and `false`/`0` to disable.

### Recommended Rollout Sequence

1. **Start**: Set `SALMONLOOP_SKILL_LEGACY_DIRECT_MD=true` and `SALMONLOOP_SKILL_PARSER_STRICT=false` to keep everything working while you migrate.
2. **Migrate**: Convert all skills to `skill-name/SKILL.md` format using the steps above.
3. **Tighten**: Remove the `legacyDirectMd` override (or set to `false`) and set `parserStrict` back to `true`.

## Discovery Path Priority

Skills are discovered in this order (first match wins when names collide):

1. Config extra paths (from `skills.json` `discovery.paths`)
2. `{repo}/.salmonloop/skills`
3. `{repo}/.agents/skills`
4. `{repo}/.claude/skills` (compat, requires `useDefaults: true`)
5. `~/.salmonloop/skills`
6. `~/.agents/skills`
7. `~/.claude/skills` (compat, requires `useDefaults: true`)

If two skills share the same `name` across different paths, the higher-priority path wins and a warning is logged.
