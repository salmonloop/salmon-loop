# Salmon-Loop

[English](README.md) | [简体中文](README.zh-CN.md)

SalmonLoop is a patch-first coding agent for repositories that care about safety, auditability, and clean diffs.
It behaves like an agent when a task needs reasoning, but it stays strict about verification, rollback, and protecting user data.

## Why SalmonLoop

- **Agent, with guardrails**: SalmonLoop can plan, patch, verify, and serve through ACP/A2A, but it does not get a free pass to mutate your repo however it wants.
- **Patch-first by default**: Changes are generated as diffs, not mystery rewrites.
- **Verify before success**: A run is only successful if your verification command passes.
- **Built for messy real repos**: The worktree strategy keeps dirty workspaces safer by isolating execution and applying changes back carefully.
- **Observable**: Sessions, audit events, snapshots, and structured outputs make it easier to inspect what happened.

## The Vibe

SalmonLoop is not trying to be an always-on autopilot that wanders around your codebase.
It is a disciplined engineering agent: focused instructions in, reviewable patches out.

The execution model stays pragmatic:

1. **Deterministic tools** for cheap, reliable operations.
2. **Microtasks** for small logic bridges and context assembly.
3. **Sub-agents** for multi-step tasks that actually need agent behavior.

## Quickstart

### 1. Install

```bash
bun install
bun run build
```

Requires `bun >= 1.3.9`.

### 2. Configure an LLM

Create a local `.env` and set the preferred environment variables:

```bash
SALMONLOOP_API_KEY=your-key
SALMONLOOP_BASE_URL=https://api.openai.com/v1
SALMONLOOP_MODEL=gpt-4.1-mini
```

Legacy `S8P_*` aliases still work, but new setups should prefer `SALMONLOOP_*`.

### 3. Run a patch task

```bash
s8p run \
  --repo /path/to/your/repo \
  --instruction "Fix the null handling in src/user.ts" \
  --verify "bun run test" \
  --checkpoint-strategy worktree
```

If you want the interactive UI instead:

```bash
s8p
```

### 4. Serve it as an agent

```bash
s8p serve
```

This starts the built-in agent server stack for A2A and local sidecar integration.

## What Users Usually Care About

- **Chat mode**: `s8p` or `s8p chat`
- **Single run**: `s8p run --instruction "..." --verify "..."`
- **Context only**: `s8p context -i "..."`
- **Snapshots**: `s8p snap ls`, `s8p snap show <hash>`, `s8p checkout <hash>`
- **Headless / CI**: `--output-format json` or `--output-format stream-json`

More detail lives in [docs/user/cli.md](docs/user/cli.md), [docs/user/config.md](docs/user/config.md), and [docs/reference/headless.md](docs/reference/headless.md).

## Safety Model

SalmonLoop is opinionated here, on purpose.

- **User data safety comes first**: the execution contract is designed to avoid unintended writes to the main workspace and Git index.
- **Dirty workspace support is explicit**: use `worktree` when you need isolation and safer apply-back behavior.
- **Rollback is part of the design**: failed verification is not a soft warning; it is a failed run.
- **Read-only phases stay read-only**: exploration, planning, and validation do not get casual write access.

If you want the exact contract, start with [docs/design/execution-contract.md](docs/design/execution-contract.md).

## Extensibility

- **Language plugins**: add support under `.salmonloop/languages/<lang>/index.js`
- **External tools and MCP**: configure extensions under `.salmonloop/config/`
- **Embedded usage**: SalmonLoop can be used as a library inside your own tooling

See [docs/user/plugins.md](docs/user/plugins.md) and [docs/user/extensions.md](docs/user/extensions.md).

## Contributing

For contributors, the short version is:

```bash
bun run setup:hooks
bun run verify
```

`bun run verify` is the delivery bar for code changes in this repository.

Useful docs:

- [docs/contributing/contributing.md](docs/contributing/contributing.md)
- [docs/contributing/testing.md](docs/contributing/testing.md)
- [docs/contributing/coding-standards.md](docs/contributing/coding-standards.md)
- [docs/contributing/release.md](docs/contributing/release.md)
- [docs/contributing/security.md](docs/contributing/security.md)

## Docs Map

The documentation hub is [docs/README.md](docs/README.md).

Good starting points:

- [docs/getting-started/overview.md](docs/getting-started/overview.md)
- [docs/getting-started/quickstart.md](docs/getting-started/quickstart.md)
- [docs/user/execution-safety.md](docs/user/execution-safety.md)
- [docs/design/execution-limits.md](docs/design/execution-limits.md)
- [docs/reference/changelog.md](docs/reference/changelog.md)

## License

MIT
