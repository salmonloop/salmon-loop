# Extensions resolution system

SalmonLoop now treats external capabilities (MCP servers, localized tool plugins, and skill directories) as a single **extensions** surface. This module bridges the JSON config files that live under `.salmonloop/config` (and the user-specific `~/.salmonloop/config`) with the toolstack that ultimately executes the tools.

## Configuration files & precedence

- `.salmonloop/config/mcp.json` and `~/.salmonloop/config/mcp-user.json` describe MCP servers. Each entry must set exactly one of `command` (stdio) or `url` (Streamable HTTP). Stdio entries can set `args`, `env`, and `cwd`; HTTP entries can set `headers`. Both support `allow.tools`, `allow.resources`, and `enabled`. Unless a repo-level entry overrides, user entries default to `enabled: false`.
- `.salmonloop/config/tools.json` / `tools-user.json` declare plugin manifests. They list the path that exports `register(): ToolSpec[]`, an `allowUserScope` flag, and the `enabled` state.
- `.salmonloop/config/skills.json` / `skills-user.json` control extra skill discovery paths and whether legacy defaults (`~/.claude/skills`, `repo/.claude/skills`) remain in play.
- Resolution merges user config first, then repo config (repo overrides) and produces a `ResolvedExtensions` object alongside a redacted variant for printing. Secret values inside `env` are masked using `/key|token|secret|password/i`.

## Resolution pipeline

1. `src/core/extensions/paths.ts` defines absolute defaults for the six config files and helpers like `resolveRepoRelative()` / `expandHome()` so that relative paths resolve against the repo root while `~` expands to the home directory.
2. `load.ts` reads & parses JSON (via Zod schemas in `schemas.ts`) and distinguishes between “file missing” vs “invalid contents”. Errors bubble up as `ExtensionConfigError`.
3. `merge.ts` overlays repo entries on top of user entries, honoring `enabled: false` overrides and capturing the `scope` of the winning entry.
4. `index.ts` exposes `resolveExtensions({ repoRoot })`. It returns:
   - `resolved: ResolvedExtensions`: arrays of `mcpServers`, `toolPlugins`, and the computed `skillDiscovery` paths (with scope markers).
   - `rawEffective`: the raw JSON definitions that survived merging (for `config print --effective` or CLI debugging).
   - `redacted`: the same `ResolvedExtensions` with secrets scrubbed.

## Toolstack integration

- `createStandardToolstack` now accepts `extensions?: ResolvedExtensions` and feeds:
  - the optionally customized `SkillLoader` (see below),
  - the new MCP loader (`src/core/tools/mcp/loader.ts`), and
  - the plugin loader (`src/core/tools/plugins/loader.ts`).
- `registerMcpTools` starts each enabled server, calls `tools/list`, and registers namespaced tools like `mcp.<server>.<tool>`. `allow.tools` is required; tools are restricted to `[Phase.VERIFY]`, report `riskLevel: 'medium'`, and always include `['process','network']` side effects.
- `registerPluginTools` imports configured modules, calls their `register()` hooks, validates that each returned `ToolSpec` declares `source: 'plugin'`, side effects, and allowed phases, then renames them to `plugin.<pluginId>.<toolName>`. User-scope plugin entries must explicitly set `allowUserScope`.
- Skills registered via `skillToToolSpec(skill, toolRouter)` delegate execution to `executeSkill()` through the governed `SkillRunner` path. The `ToolRouter` parameter is required — see "Unified execution path" below.
- `run`, `parallel`, and the preflight step all call `resolveExtensions()` so that Toolstack creation and the authorization provider share the same extension scope.

## Skill architecture

### Unified execution path

Both entry points — slash commands (`/skill-name` via `SlashRouter`) and tool-bridge invocations (`bridge.ts` via `ToolRegistry`) — now converge on a single governed execution path:

1. `bridge.ts` → `skillToToolSpec(skill, toolRouter)` creates a `ToolSpec` whose executor delegates to `executeSkill()` from `SkillRunner.ts`.
2. `SkillRunner` uses the DSL `MicroTaskRunner` (`src/core/grizzco/dsl/MicroTaskRunner.ts`) which resolves `sh:*` data references through `ToolRouter`.
3. Every shell command passes through the full ToolRouter governance chain: Registry → Validation → Policy → Authorization.

The legacy `MicroTaskRunner` (`src/core/skills/runtime/MicroTaskRunner.ts`) that previously called `execa` directly has been restricted to test-only usage. A runtime guard throws if it is invoked outside a test context. The bridge kill-switch (`SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC`) can disable bridge-path skill execution entirely in non-dev environments.

### Layered authorization cache

`ToolRouter.buildAuthorizationKey()` now uses a two-tier cache key strategy:

- **High-risk tools** (sideEffects includes `process`, `fs_write`, or `network`): cache key = `toolName:phase:argsHash`. Different arguments require re-authorization.
- **Low-risk tools** (read-only): cache key = `toolName:phase`. A single authorization covers all argument variations for the same tool and phase.

`isHighRiskTool(spec)` checks the tool's `sideEffects` array against the high-risk set. This prevents a session authorization for one shell command from silently expanding to cover arbitrary other commands.

### Path trust boundary

Repo-scoped skill discovery paths are validated via `isWithinRoot()` in `src/core/extensions/paths.ts`:

```typescript
isWithinRoot(candidate: string, root: string): boolean
```

This function uses `fs.realpathSync` to resolve symlinks before checking containment. For repo-scoped paths:

- Paths resolving outside the repo root are rejected with an audit event.
- Absolute paths are rejected in repo scope (only user-level config may specify absolute paths).
- Symlink escape attempts are detected through realpath resolution.

User-scoped paths (`~/.salmonloop/skills`, `~/.agents/skills`, etc.) are not subject to repo-root containment.

## Skill discovery behavior

### Directory convention

Skills follow the AgentSkills subdirectory format by default:

```
skills-root/
  my-skill/
    SKILL.md          ← canonical format
  another-skill/
    SKILL.md
```

The `skill-name/SKILL.md` pattern is the only format accepted in default mode. Legacy direct `.md` files (e.g., `skills-root/my-skill.md`) require a compatibility feature flag and emit a deprecation warning when loaded.

### Discovery path priority

Skill discovery follows a 7-level priority order (highest to lowest). When two skills share the same name, the first-discovered skill wins and a warning is logged:

| Priority | Path | Scope |
|----------|------|-------|
| 1 | Config extra paths (`skills.json` discovery.paths) | config |
| 2 | `{repoRoot}/.salmonloop/skills` | repo |
| 3 | `{repoRoot}/.agents/skills` | repo |
| 4 | `{repoRoot}/.claude/skills` (compat) | repo |
| 5 | `~/.salmonloop/skills` | user |
| 6 | `~/.agents/skills` | user |
| 7 | `~/.claude/skills` (compat) | user |

The `.agents/skills` paths at both project and user level provide cross-client interoperability with the AgentSkills ecosystem. The `.claude/skills` compat paths can be disabled via `useDefaults: false` in `skills.json`.

### Loader configuration

`SkillLoader` accepts `{ repoRoot, useDefaults?: boolean, extraPaths?: string[] }`. `extraPaths` comes from the `skills.json` discovery list, and `useDefaults` lets repo/user config disable the legacy compatibility paths. The loader receives the repo root explicitly, so loading no longer depends on `process.cwd()` and works consistently in worktrees/shadow copies.

Directory scanning limits: `.git/` and `node_modules/` are skipped, max depth 6, max 2000 directories.

### Strict frontmatter parsing

Skill frontmatter is parsed with the `yaml` library and validated against a Zod schema (`SkillFrontmatterSchema`):

- `name`: required, 1–64 chars, Unicode lowercase alphanumeric + hyphens (per AgentSkills spec). No leading/trailing/consecutive hyphens. Must match the parent directory name (strict mode rejects on mismatch; compat mode warns).
- `description`: required, 1–1024 chars.
- `userInvocable`: optional boolean (default `true`). Coerced from string `"false"` to actual `false`. When `false`, the skill is excluded from slash command suggestions and invocable listings.
- `paths`: optional string array for conditional activation patterns.
- Additional optional fields: `license`, `compatibility`, `metadata`, `allowedTools`, `context`.

Missing or malformed frontmatter results in a descriptive error — the parser never silently falls back to using the file path as the skill ID.

## Progressive disclosure

Skill loading uses a two-tier progressive disclosure pipeline to keep startup context cost sublinear:

- **Tier 1 — `loadCatalog()`**: Parses only frontmatter at startup, producing `SkillCatalogEntry` objects (name + description + location + scope). Cost is approximately 50–100 tokens per skill.
- **Tier 2 — `activateSkill(id)`**: Loads the full SKILL.md content on demand when the model or agent activates a skill by name. Tracks activation state per skill.

The legacy `initialize()` method remains as a backward-compatible full-load path.

```typescript
interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  location: string;
  scope: 'repo' | 'user' | 'config';
  conditionalPaths?: string[];
}
```

## Dynamic skill discovery

`SkillDiscoveryWatcher` monitors file-operation signals during a session to detect new skill directories appearing at runtime. It also supports the frontmatter `paths` field for conditional activation:

- When a file matching a skill's `paths` pattern is touched, the skill is promoted from catalog-only to activated.
- When no matching files are present, the conditional skill remains in catalog-only mode, contributing zero context cost.

This allows context-relevant skills to surface automatically without inflating the baseline context window.

## Skill permissions

`SkillPermissionManager` provides skill-level granularity for permission grants:

- **Exact policies**: grant permission for a specific tool invocation by a specific skill.
- **Prefix policies**: grant permission for a class of tool invocations matching a prefix pattern.

Permissions are persisted to the allowlist with auditable provenance (which skill requested, when, and what was granted).

## Feature flags

Staged rollout of the new skill architecture is controlled via centralized feature flags in `src/core/skills/feature-flags.ts`:

| Flag | Purpose | Default |
|------|---------|---------|
| Parser strictness | Strict YAML + Zod validation vs. lenient legacy parsing | strict |
| Loader format | SKILL.md subdirectory only vs. compat (also accepts direct `.md`) | SKILL.md only |
| Bridge kill-switch | `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` — disable bridge-path execution | disabled in non-dev |

## Skill audit events

Every skill execution emits structured audit events for observability:

- `SKILL_EXECUTION_START`: emitted before execution in both slash and bridge paths.
- `SKILL_EXECUTION_END`: emitted after successful execution.
- `SKILL_EXECUTION_DENIED`: emitted when execution is blocked, includes deny reason and source.

Each event carries: `skillId`, `route` (slash-governed | tool-bridge), `runnerClass`, `commandCount`, `authorizationMode`, `argsHash`, and `traceId` for cross-event correlation.

## Governance reminders

- MCP/plugin tools are registered with `sideEffects` that trigger the policy guard. Plugin tools are also audited with their plugin ID (`meta` data is constructed in `registerPluginTools`).
- Skill shell commands are governed by the same ToolRouter policy chain as all other tools. The `isHighRiskTool` check ensures high-risk skill commands require per-invocation authorization.
- Extension configuration is not exposed to LLMs directly; only the resolved tools make it into the `ToolRegistry`. The CLI can still print the redacted extension bundle via `s8p run --print-config` or the future `s8p config print --effective`.
