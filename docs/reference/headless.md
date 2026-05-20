# Headless Output (JSON / JSONL)

This page describes SalmonLoop's *headless* CLI output modes intended for scripts and CI.

## Overview

- `--output-format text` (default): human-readable output.
- `--output-format json`: prints a single JSON object to **stdout** on completion.
- `--output-format stream-json`: prints newline-delimited JSON (JSONL) to **stdout** as the run progresses.
  - Human logs and unexpected diagnostics are routed to **stderr** to keep stdout machine-readable.
  - Expected operational warnings are included in the JSON payload instead of being printed to stderr.

For the full CLI surface (all flags), see `docs/user/cli.md`.

## Protocol profiles (stream-json)

`--output-profile <profile>` selects the JSONL event protocol when `--output-format stream-json`:

- `native` (default): SalmonLoop-native, versioned and extensible (Claude-inspired).
- `anthropic`: strict Anthropic / Claude Code-compatible JSONL protocol.
- `openai`: strict OpenAI Responses streaming event protocol (each JSONL line is an OpenAI `ResponseStreamEvent` object).

## Native protocol stability

Native headless payloads are explicit about protocol versions:

- `--output-format json` includes `metadata.schema_version`.
- `--output-format stream-json --output-profile native` includes `protocol_version` on every line.
- Native JSONL lines include monotonic `event_seq` values starting at `0`.

Use `event_seq` for incremental readers, resume-safe consumers, and log de-duplication. Strict
`anthropic` and `openai` profiles intentionally keep their upstream-compatible shapes and do not
receive SalmonLoop-specific fields.

## Warnings

In headless mode, expected warnings are structured data:

- JSON output: `metadata.warnings`
- Native stream output: `event.warnings` on the final `result` event

Each warning has:

```json
{
  "code": "LLM_CREDENTIAL_MISSING",
  "message": "LLM credential not configured; using StubLLM. Configure provider credentials to use a real LLM.",
  "source": "llm.runtime",
  "severity": "warning"
}
```

This keeps successful headless runs quiet on stderr while still preserving actionable state for
automation.

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

## Authorization behavior in headless mode

Headless runs should assume non-interactive operation:

- Keep `context.cache.path` inside `context.cache.allowedRoots`.
- By default, outside-root cache paths are denied.
- If you intentionally need an outside-root cache for a single run, pass
  `--allow-outside-cache-root` explicitly.

Recommended CI posture:

- Treat `--allow-outside-cache-root` as an exception path.
- Require explicit invocation per job instead of setting it globally.

## Smoke checklist (real providers)

This checklist is intentionally small and CI-friendly. It validates the headless contract in a
real network environment without depending on UI/TUI behavior.

Prerequisites:

- Provide the correct API key(s) for your configured provider(s).
- Run from a git repo (or use `-r/--repo`).

### 1) JSONL validity and stdout purity

- Ensure `stdout` contains only JSON objects (one per line).
- Ensure expected warnings are represented as structured `warnings`, not stderr text.
- Ensure native JSONL `event_seq` values are contiguous.

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

## SWE-bench Smoke Harness

Use the project runner when validating benchmark behavior:

```bash
bun run smoke:swebench -- \
  --instance-file fixtures/swebench-instance.json \
  --config .salmonloop/config/config.json \
  --overlay fixtures/swebench-overlay.json \
  --behavior-command "python tests/repro.py" \
  --regression-command "python -m pytest test/rules/test_l031.py"
```

For deterministic local harness tests, pass `--instance-file` plus `--source-repo` so the runner
fetches from a local git repository instead of GitHub.

The runner writes `report.json`, keeps its output directory by default so artifact paths stay
durable, and intentionally separates these outcomes:

- `flowSuccess`: SalmonLoop completed the headless run.
- `reproductionPrepared`: the harness has a non-trivial reproduction command and any overlay
  files were committed before the agent ran.
- `patchApplyable`: the patch is non-empty, parses as SWE-bench prediction JSONL, passes
  `git diff --check`, the prediction `model_patch` matches the exported patch artifact, and the
  patch applies with `git apply --check`.
- `behaviorVerified`: the reproduction command passed and `--verify` was not a trivial
  flow-only command such as `true`.
- `regressionVerified`: the PASS_TO_PASS/local regression command passed. Missing regression
  commands are reported as skipped and do not satisfy the local quality bar.
- `submitted` / `resolved`: optional `sb-cli` submission state.

`--verify true` is valid only for protocol smoke. It is reported as `WEAK_VERIFY_COMMAND` and
cannot satisfy the local quality bar.

Behavior and regression commands run in a clean benchmark worktree with the exported
`model_patch` applied. This catches patches that only pass because ignored or generated files were
left behind in the agent worktree.

Use `--out <dir>` to choose a durable artifact location. Use `--cleanup` only for disposable
protocol smoke runs where the printed JSON report is enough.

When `--overlay` is provided, overlay files are committed before the agent runs. This lets the
harness add reproduction tests without leaking those tests into the exported `model_patch`.
