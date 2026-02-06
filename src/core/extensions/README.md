# Extensions package overview

`src/core/extensions` is the developer-facing runtime that bridges the JSON configuration files under `.salmonloop/config` (and the user equivalents in `~/.salmonloop/config`) with the toolstack initialization sequence. This directory is the go-to location when you need to understand:

- **What files we load** (`paths.ts`): defaults for `mcp.json`, `tools.json`, `skills.json`, plus helpers to resolve repo-relative paths and expand `~`.
- **How we validate** (`schemas.ts` + `load.ts`): Zod schemas enforce shape, while `loadConfig` reports missing files vs invalid JSON via `ExtensionConfigError`.
- **How we merge scopes** (`merge.ts`): user entries come first, repo entries override, and the winning `scope` (user/repo) is stored alongside each entry so downstream consumers can reason about origin.
- **The public API** (`index.ts`): `resolveExtensions({ repoRoot })` returns:
  - `resolved: ResolvedExtensions` – arrays of `mcpServers`, `toolPlugins`, and skill discovery metadata that new loaders use.
  - `rawEffective` – the raw JSON objects that survived merging (useful for `config print --effective`).
  - `redacted` – secrets in `env` fields are masked before any CLI output.

Other modules (the CLI commands, tool loader, and preflight step) call `resolveExtensions()` before building a `ToolRegistry`, ensuring MCP/plugin tools and skills all draw from the same deterministic source. When you add new extension types, update this package first so the loader/routing pipeline can consume them.
