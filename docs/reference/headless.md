# Headless Output (JSON / JSONL)

This page describes SalmonLoop's *headless* CLI output modes intended for scripts and CI.

## Overview

- `--output-format text` (default): human-readable output.
- `--output-format json`: prints a single JSON object to **stdout** on completion.
- `--output-format stream-json`: prints newline-delimited JSON (JSONL) to **stdout** as the run progresses.
  - Human logs are routed to **stderr** to keep stdout machine-readable.

For the full CLI surface (all flags), see `docs/user/cli.md`.

## Protocol profiles (stream-json)

`--output-profile <profile>` selects the JSONL event protocol when `--output-format stream-json`:

- `native` (default): SalmonLoop-native, versioned and extensible (Claude-inspired).
- `anthropic`: strict Anthropic / Claude Code-compatible JSONL protocol.
- `openai`: strict OpenAI Responses streaming event protocol (each JSONL line is an OpenAI `ResponseStreamEvent` object).

## Tool timelines

The CLI distinguishes two related but different timelines:

- **Model tool request timeline**: when the model *requests* a tool (semantic intent).
- **Host tool execution timeline**: when SalmonLoop actually *executes* the tool and returns results.

Profiles map these timelines differently depending on compatibility constraints.

## Redaction and payload flags

Headless output is safe-by-default:

- Tool inputs and tool outputs are **redacted** unless explicitly enabled.
- Use `--headless-include-tool-input` / `--headless-include-tool-output` only in trusted environments.

## Exit codes

Headless automation should rely on exit codes instead of parsing human logs:

- `0`: success
- `1`: failure
- `130`: cancelled (Ctrl+C)

These are implemented in `src/core/runtime/exit-codes.ts`.

## Smoke checklist (real providers)

This checklist is intentionally small and CI-friendly. It validates the headless contract in a
real network environment without depending on UI/TUI behavior.

Prerequisites:

- Provide the correct API key(s) for your configured provider(s).
- Run from a git repo (or use `-r/--repo`).

### 1) JSONL validity and stdout purity

- Ensure `stdout` contains only JSON objects (one per line).
- Ensure human logs are routed to `stderr`.

Example:

```bash
s8p run -p "Say hello" --output-format stream-json --output-profile native | jq -c .
```

You can also run the repo smoke script:

```bash
bun run test:headless-smoke
```

Repeat for each profile:

```bash
s8p run -p "Say hello" --output-format stream-json --output-profile anthropic | jq -c .
s8p run -p "Say hello" --output-format stream-json --output-profile openai | jq -c .
```

### 2) Tool calling timeline (one safe read tool)

- Confirm you see:
  - a model tool request event / block (`tool_use` or `function_call`)
  - a host tool execution completion (`tool_result` in native/anthropic; not emitted in strict openai)

Example:

```bash
s8p run -p "Read README.md and summarize it." --output-format stream-json --output-profile native | jq -c .
```

### 3) Cancellation semantics

- Ctrl+C should exit with code `130`.
- `stdout` must remain machine-readable (no partial non-JSON noise).

### 4) Usage errors are machine-readable

- Invalid flag combinations must not print help text to stdout in headless mode.
- Confirm `exit code = 1`.
