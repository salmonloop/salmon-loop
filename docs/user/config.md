# Configuration

SalmonLoop supports repository-local JSON configuration.

By default, SalmonLoop looks for a config file at:

`<repoRoot>/.salmonloop/config/config.json`

`/.salmonloop/` is intended to be **local-only** and should be gitignored.

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

## Environment Variables (Provider)

- `SALMONLOOP_API_KEY` / `S8P_API_KEY`: API key fallback if not present in config.
- `S8P_BASE_URL` / `SALMON_BASE_URL`: Base URL fallback if not present in config.
- `S8P_MODEL` / `SALMON_MODEL`: Model fallback if not present in config.
