# Skills Module (`src/core/skills/`)

Internal developer reference for the skills subsystem.

## Security Model

All skill execution — whether triggered via slash command or tool bridge — flows through a single governed path:

```
Entry (slash | bridge) → executeSkill() → DSL MicroTaskRunner → ToolRouter.call()
```

Key invariants:

- **Unified execution**: `bridge.ts` delegates to `executeSkill()` in `SkillRunner.ts`, never to the legacy `MicroTaskRunner` directly.
- **ToolRouter governance**: Every shell command resolves through `ToolRouter` (Registry → Validation → Policy → Authorization). No direct `execa`/`spawn` bypass exists in production code.
- **Legacy runner restricted**: `runtime/MicroTaskRunner.ts` throws if invoked outside a test context.
- **Kill-switch**: Bridge execution can be disabled via `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` (see Feature Flags).
- **Audit trail**: `SkillAuditEvent` emitted at start, end, and denial of every execution with `traceId`, route, and args hash.

## Parser (`parser.ts`)

`SkillParser.parse()` extracts and validates YAML frontmatter using the `yaml` library + Zod schema.

Frontmatter rules:
- `name`: required, 1–64 chars, Unicode lowercase alphanumeric + hyphens (per AgentSkills spec, using `\p{Ll}\p{N}` property escapes), no consecutive hyphens.
- `description`: required, 1–1024 chars
- `userInvocable`: coerced to boolean (never stored as string)
- Name must match parent directory name (strict mode: reject; compat mode: warn)
- Missing or malformed frontmatter is a hard error — no silent fallback

`SkillParser.extractCommands()` applies security guards:
- Max 4096 chars per command
- Control characters rejected
- Configurable dangerous-pattern deny-list (e.g. `rm -rf /`, `curl | sh`, `eval`)

## Loader (`loader.ts`)

`SkillLoader` discovers and loads skills with progressive disclosure.

### Directory format

Default: `skill-name/SKILL.md` subdirectory format only.
Legacy direct `.md` files require the `SALMONLOOP_SKILL_LEGACY_DIRECT_MD` compat flag and emit deprecation warnings.

### Discovery path priority (high → low)

1. Config extra paths (`skills.json` discovery.paths)
2. `{repoRoot}/.salmonloop/skills`
3. `{repoRoot}/.agents/skills`
4. `{repoRoot}/.claude/skills` (compat)
5. `~/.salmonloop/skills`
6. `~/.agents/skills`
7. `~/.claude/skills` (compat)

First-win conflict resolution: if two skills share a name, the higher-priority path wins and a warning is logged.

Repo-scoped paths are validated through `isWithinRoot()` (realpath-based) to prevent path traversal escapes.

### Progressive disclosure

| Tier | Method | What loads | When |
|------|--------|-----------|------|
| 1 | `loadCatalog()` | Name + description + location (~75 tokens/skill) | Startup |
| 2 | `activateSkill(id)` | Full SKILL.md content | On demand |
| Legacy | `initialize()` | Everything | Backward compat |

## Dynamic Discovery (`discovery.ts`)

`SkillDiscoveryWatcher` provides signal-based (not fs.watch) discovery:
- `refreshCatalog()`: detects newly added skill directories by diffing against known IDs
- `checkConditionalActivation()`: matches file paths against frontmatter `paths` globs to activate context-relevant skills

## Permissions (`permissions.ts`)

`SkillPermissionManager` manages skill-level allow policies:
- `exact` match: single skill ID
- `prefix` match: all skills with a given ID prefix
- Persisted to JSON with auditable provenance (`grantedBy`, `grantedAt`)

## Feature Flags (`feature-flags.ts`)

| Flag | Env Var | Default | Effect |
|------|---------|---------|--------|
| `parserStrict` | `SALMONLOOP_SKILL_PARSER_STRICT` | `true` | Reject name-directory mismatches (false = warn only) |
| `legacyDirectMd` | `SALMONLOOP_SKILL_LEGACY_DIRECT_MD` | `false` | Accept legacy direct `.md` files with deprecation warning |
| `bridgeDisabled` | `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` | `true` (non-dev) | Kill-switch: disable bridge execution path entirely |

## Key Modules

| File | Purpose |
|------|---------|
| `bridge.ts` | Converts `Skill` → `ToolSpec` for ToolRegistry; delegates to governed `executeSkill()` |
| `parser.ts` | Strict YAML + Zod frontmatter parsing, command extraction with security guards |
| `loader.ts` | Skill discovery, path priority, progressive disclosure (catalog / activate / initialize) |
| `discovery.ts` | Signal-based dynamic discovery and conditional activation via `paths` globs |
| `permissions.ts` | Skill-level exact/prefix permission policies with JSON persistence |
| `feature-flags.ts` | Centralized env-var flags for parser strictness, loader format, bridge kill-switch |
| `audit.ts` | `SkillAuditEvent` interface and emission helpers (`emitSkillAuditEvent`, `generateSkillTraceId`) |
| `types.ts` | Core types: `Skill`, `SkillFrontmatter`, `SkillCatalogEntry`, `IExecutable` |
| `runtime/SkillRunner.ts` | `executeSkill()` — the unified governed execution entry point |
| `runtime/MicroTaskRunner.ts` | Legacy runner — test-only, throws in production context |
