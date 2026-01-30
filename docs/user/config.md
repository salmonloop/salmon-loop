# Configuration

SalmonLoop currently supports configuration primarily via CLI flags and environment variables.

## Environment Variables (Provider)

- `S8P_API_KEY` / `SALMON_API_KEY`: API key for the configured provider.
- `S8P_BASE_URL` / `SALMON_BASE_URL`: Override provider base URL.
- `S8P_MODEL` / `SALMON_MODEL`: Model identifier.

## Precedence (planned)

The intended precedence order is:

1. Defaults
2. Config file (JSON)
3. Environment variables
4. CLI flags

This page will be expanded when JSON config is introduced.

