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

## CLI Options

- `--config <path>`: Explicitly load a config file (relative paths are resolved against the repo root).
- `--no-config-file`: Disable loading the repo config file.
- `--print-config`: Print the resolved config (redacted) and exit.

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
- `SALMONLOOP_BASE_URL` / `S8P_BASE_URL` / `SALMON_BASE_URL`: Base URL fallback if not present in config. Prefer `SALMONLOOP_BASE_URL` and omit the trailing slash (e.g., `https://openrouter.ai/api/v1`); the runtime trims extra slashes and keeps legacy env names for compatibility.
- `SALMONLOOP_MODEL` / `S8P_MODEL` / `SALMON_MODEL`: Model choice (SALMONLOOP_MODEL preferred).

## Extending with external tools

For guidance on configuring MCP servers, tool plugins, and skill directories, see [Extension configuration](extensions.md). That doc walks through the new `.salmonloop/config/*.json` files, scopes, and the effective `extensions` payload that SalmonLoop resolves before each run.
