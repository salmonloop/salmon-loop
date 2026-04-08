# Skill Migration Guide: Legacy `.md` -> `SKILL.md` Subdirectory Format

SalmonLoop follows the [AgentSkills](https://agentskills.io/specification) directory convention.

## Required format

| Before (legacy) | After (required) |
| --- | --- |
| `skills/my-skill.md` | `skills/my-skill/SKILL.md` |

The loader reads only `skill-name/SKILL.md`.

## Migration steps

For each legacy file:

```bash
mkdir -p .salmonloop/skills/my-skill
mv .salmonloop/skills/my-skill.md .salmonloop/skills/my-skill/SKILL.md
```

Apply the same conversion for user-level skills under `~/.salmonloop/skills/`.

## Frontmatter requirements

```yaml
---
name: my-skill
description: A short description
---
```

`name` must:
- be 1-64 characters,
- use Unicode lowercase alphanumeric characters and hyphens,
- avoid leading/trailing/consecutive hyphens,
- exactly match the parent directory name.

Unknown frontmatter fields are rejected.

## Discovery priority

1. Config extra paths (`skills.json` `discovery.paths`)
2. `{repo}/.salmonloop/skills`
3. `{repo}/.agents/skills`
4. `~/.salmonloop/skills`
5. `~/.agents/skills`

If names collide, the first discovered skill wins and a warning is logged.
