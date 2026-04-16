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
- Skills registered via `skillToToolSpec` remain unchanged but now honor the `skillDiscovery` paths that `resolveExtensions` provides.
- `run`, `parallel`, and the preflight step all call `resolveExtensions()` so that Toolstack creation and the authorization provider share the same extension scope.

## Skill discovery behavior

- `SkillLoader` now accepts `{ repoRoot, useDefaults?: boolean, extraPaths?: string[] }`. `extraPaths` comes from the `skills.json` discovery list, and `useDefaults` lets repo/user config disable the legacy compatibility paths (`~/.claude/skills`, `.claude/skills`).
- Duplicate skill IDs log a warning and are skipped.
- Since the loader receives the repo root explicitly, loading no longer depends on `process.cwd()` and works consistently in worktrees/shadow copies.

## Governance reminders

- MCP/plugin tools are registered with `sideEffects` that trigger the policy guard. Plugin tools are also audited with their plugin ID (`meta` data is constructed in `registerPluginTools`).
- Extension configuration is not exposed to LLMs directly; only the resolved tools make it into the `ToolRegistry`. The CLI can still print the redacted extension bundle via `s8p run --print-config` or the future `s8p config print --effective`.
