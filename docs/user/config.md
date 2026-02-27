# Configuration

SalmonLoop supports repository-local JSON configuration.

By default, SalmonLoop looks for a config file at:

`<repoRoot>/.salmonloop/config/config.json`

`/.salmonloop/` is intended to be **local-only** and should be gitignored.

This repository also includes a `config.example.json` at the project root as a starting point.

## Precedence

The precedence order is:

1. Defaults
2. Config file (JSON)
3. Environment variables
4. CLI flags

## Context Targeting & Cache

### `context.churn.weight`

Controls churn-aware target ranking layers:

- `primary`: fixed boost applied to the primary target layer.
- `rerank`: churn contribution in the main ranking score.
- `tiebreak`: churn contribution only when final scores are tied.

Example:

```json
{
  "context": {
    "churn": {
      "weight": {
        "primary": 10000,
        "rerank": 0.35,
        "tiebreak": 0.05
      }
    }
  }
}
```

Notes:

- Keep `primary` much larger than semantic scores to guarantee deterministic primary-first behavior.
- Keep `rerank` moderate (`0.2-0.5`) so churn improves ordering without overriding semantic intent.
- Keep `tiebreak` small (`0-0.1`) to avoid instability.

### Context Signatures

SalmonLoop uses canonical signatures for context consistency:

- `intentSignature`: derived from instruction, primary file hint, selection, and diff scope.
- `targetSetSignature`: derived from resolved target list (path/reason/confidence/ranking).
- `contextHash`: canonical hash of final packed context content.
- Signatures are versioned (`intent:v1:*`, `targets:v1:*`, `context:v1:*`) for forward-compatible algorithm upgrades.

These signatures are emitted in context audit events to make cache hits/misses explainable.

## CLI Options

- `--config <path>`: Explicitly load a config file (relative paths are resolved against the repo root).
- `--no-config-file`: Disable loading the repo config file.
- `--print-config`: Print the resolved config (redacted) and exit.

## UI Logging (TUI)

SalmonLoop separates **what** the TUI shows (mode) from **how dense** it renders (view).

### `ui.log.mode`

Controls log visibility and summarization in the TUI:

- `quiet`: Minimal output. Keep warnings/errors and essential phase milestones.
- `normal`: Default. Balanced output for new users.
- `debug`: Maximum detail, including debug-level messages and tool call details.

Example:

```json
{
  "ui": {
    "log": {
      "mode": "normal"
    }
  }
}
```

Environment variable overrides (preferred):

- `SALMONLOOP_UI_LOG_MODE`: `quiet|normal|debug`
- `SALMONLOOP_UI_MODE`: alias

### `ui.log.view`

Controls rendering density:

- `compact`: Most compact layout.
- `standard`: Default layout.
- `full`: Most verbose layout (more labels/timestamps/spacing).

Example:

```json
{
  "ui": {
    "log": {
      "view": "standard"
    }
  }
}
```

Environment variable overrides:

- `SALMONLOOP_UI_LOG_VIEW`
- `SALMONLOOP_UI_LOG`
- `SALMONLOOP_UI_DENSITY`

Notes:

- If `ui.log.view` is not set, SalmonLoop derives a default from `ui.log.mode`:
  - `quiet` -> `compact`
  - `normal` -> `standard`
  - `debug` -> `full`
- Setting `ui.log.view` explicitly always wins over the derived default.

## LLM Configuration (v1)

Minimal example:

```json
{
  "version": 1,
  "llm": {
    "active": "openaiMain",
    "providers": {
      "openaiMain": {
        "type": "openai-compatible",
        "client": {
          "package": "@ai-sdk/openai"
        },
        "api": {
          "baseUrl": "https://api.openai.com/v1",
          "apiKey": null,
          "timeoutMs": 60000,
          "headers": {}
        },
        "models": {
          "default": {
            "id": "gpt-4.1-mini"
          }
        }
      }
    }
  }
}
```

Notes:

- `api.apiKey` can be stored inline for convenience, but it is sensitive. Keep `.salmonloop/` gitignored.
- If `api.apiKey` is not set, SalmonLoop falls back to environment variables:
  - `SALMONLOOP_API_KEY` (preferred)
  - `S8P_API_KEY` (legacy)

## Observability: Langfuse (via LiteLLM)

SalmonLoop can:

- correlate LLM calls into a single Langfuse trace (`run-xxxx`) via Langfuse headers
- report run outcome (`metadata.salmonloop.*` + numeric scores) for success-rate tracking

Config example:

```json
{
  "observability": {
    "langfuse": {
      "enabled": true,
      "outcome": true,
      "endpoint": "https://your-litellm-host/langfuse/",
      "userId": "user-123"
    }
  }
}
```

Notes:

- `observability.langfuse.endpoint` is the LiteLLM Langfuse proxy endpoint (not the Langfuse Cloud host).
- If `endpoint` is omitted, SalmonLoop derives the LiteLLM root from `llm.providers.*.api.baseUrl` by stripping `/v1`.
- If the derived root host is a known public LLM provider host (OpenAI/Anthropic/Gemini), outcome reporting is disabled unless
  you explicitly set `observability.langfuse.endpoint`.
- `enabled` controls Langfuse correlation headers on _LLM_ calls (spans/tokens). `outcome` controls the end-of-run ingestion
  request (scores + `metadata.salmonloop.*`). You can enable either independently.
- If `sessionId` is omitted, chat mode auto-uses the local chat session ID; run mode leaves it unset.
- `sessionId` is mainly an **override** for special cases (e.g. CI batch runs / eval suites where you want many runs grouped);
  in normal interactive chat you should not set it manually.

Environment variable overrides:

- `SALMONLOOP_LANGFUSE`: override `observability.langfuse.enabled`
- `SALMONLOOP_LANGFUSE_OUTCOME`: override `observability.langfuse.outcome`
- `SALMONLOOP_LANGFUSE_PROXY_URL`: override `observability.langfuse.endpoint` (can be either a root URL or a full `/langfuse/` endpoint)
- `SALMONLOOP_LANGFUSE_SESSION_ID`: override `observability.langfuse.sessionId`
- `SALMONLOOP_LANGFUSE_USER_ID`: override `observability.langfuse.userId`
- `SALMONLOOP_LANGFUSE_PROXY_API_KEY`: optional auth key for outcome reporting (defaults to the active LLM apiKey)
- `SALMONLOOP_LANGFUSE_RELEASE`: optional release string attached to traces (useful for regressions)

## `client.package` (Optional)

`llm.providers.<key>.client.package` selects the LLM client backend used to communicate with the provider.
If omitted, SalmonLoop uses its default internal client selection logic.

Supported values (current):

- `@ai-sdk/openai`
- `@ai-sdk/openai-compatible`

Behavior:

- If `client.package` is supported, SalmonLoop uses the corresponding AI SDK provider client.
- If `client.package` is set but not supported, SalmonLoop prints a warning and falls back to the default client.

Safety note:

- `client.package` only affects the LLM transport/adapter layer. It does not change tool governance, file access rules,
  or the execution safety contract.

## `api.timeoutMs`

`llm.providers.<key>.api.timeoutMs` controls the LLM request timeout.

Notes:

- This value is used by the AI SDK transport when `client.package` selects an AI SDK adapter.
- If `client.package` is omitted and SalmonLoop uses its default client logic, timeout behavior may differ by backend.

## Environment Variables (Provider)

- `SALMONLOOP_API_KEY` / `S8P_API_KEY`: API key fallback if not present in config.
- `SALMONLOOP_BASE_URL` / `S8P_BASE_URL`: Base URL fallback if not present in config. Prefer `SALMONLOOP_BASE_URL` and omit the trailing slash (e.g., `https://openrouter.ai/api/v1`); the runtime trims extra slashes.
- `SALMONLOOP_MODEL` / `S8P_MODEL`: Model choice (SALMONLOOP_MODEL preferred).

## Markdown Output Theme (CLI UI)

`output.markdown.theme` controls the Markdown theme used in the TUI for chat/run modes.
`output.markdown.mode` controls rendering behavior:

- `enhanced` (default): SalmonLoop-enhanced rendering with line numbers and defensive formatting fixes.
- `native`: vanilla `marked-terminal` behavior.

Supported values:

- `default` (built-in marked-terminal theme)
- `vivid` (higher-contrast theme used by SalmonLoop)

Example:

```json
{
  "output": {
    "markdown": {
      "theme": "default",
      "mode": "enhanced"
    }
  }
}
```

## Extending with external tools

For guidance on configuring MCP servers, tool plugins, and skill directories, see [Extension configuration](extensions.md). That doc walks through the new `.salmonloop/config/*.json` files, scopes, and the effective `extensions` payload that SalmonLoop resolves before each run.
