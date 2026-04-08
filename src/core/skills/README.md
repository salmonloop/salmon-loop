# Skills Module (`src/core/skills/`)

Internal developer reference for the skills subsystem.

## Security Model

All skill execution flows through one governed path:

`Entry (slash | bridge) -> executeSkill() -> DSL MicroTaskRunner -> ToolRouter.call()`

Key invariants:
- Unified execution: `bridge.ts` delegates to `executeSkill()` in `runtime/SkillRunner.ts`.
- ToolRouter governance: all shell commands are policy/authorization/audit controlled.
- Legacy runner restricted: `runtime/MicroTaskRunner.ts` is test-only.
- Bridge kill-switch: `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC`.
- Audit trail: start/end/denied events with `traceId` and `argsHash`.

## Parser (`parser.ts`)

`SkillParser.parse()` uses `yaml` + strict Zod validation.

Frontmatter rules:
- `name`: required, 1-64 chars, Unicode lowercase alphanumeric + hyphens, no consecutive hyphens.
- `description`: required, 1-1024 chars.
- Optional spec fields: `license`, `compatibility`, `metadata`, `allowed-tools`.
- Unknown frontmatter keys are rejected.
- `name` must match parent directory name.
- Missing or malformed frontmatter is a hard error.

`SkillParser.extractCommands()` guards:
- max 4096 chars per command,
- control-char rejection,
- dangerous-pattern deny-list.

## Loader (`loader.ts`)

Directory format: only `skill-name/SKILL.md`.

Discovery priority (high -> low):
1. Config extra paths (`skills.json` `discovery.paths`)
2. `{repoRoot}/.salmonloop/skills`
3. `{repoRoot}/.agents/skills`
4. `~/.salmonloop/skills`
5. `~/.agents/skills`

First-win conflict resolution applies when duplicate skill names exist.

Progressive disclosure:
- Tier 1 `loadCatalog()` -> lightweight metadata
- Tier 2 `activateSkill(id)` -> full `SKILL.md`

## Dynamic Discovery (`discovery.ts`)

`SkillDiscoveryWatcher` supports signal-based catalog refresh:
- `refreshCatalog()` detects newly discovered skills.

No conditional activation by frontmatter path patterns is supported.

## Feature Flags (`feature-flags.ts`)

| Flag | Env Var | Default | Effect |
|------|---------|---------|--------|
| `bridgeDisabled` | `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` | `true` (non-dev) | Disable bridge execution path |

## Key Modules

| File | Purpose |
|------|---------|
| `bridge.ts` | `Skill` -> `ToolSpec` bridge; delegates to governed `executeSkill()` |
| `parser.ts` | Strict frontmatter parsing and command extraction guards |
| `loader.ts` | Discovery and progressive disclosure loading |
| `discovery.ts` | Signal-based catalog refresh |
| `permissions.ts` | Skill-level permission policies |
| `feature-flags.ts` | Bridge kill-switch flag |
| `audit.ts` | Skill audit event helpers |
| `types.ts` | Core skills types |
| `runtime/SkillRunner.ts` | Unified governed execution entry |
