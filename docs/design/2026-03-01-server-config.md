# Server Config Top-Level Field

## Goal

Introduce a `server` top-level configuration section that governs the A2A HTTP listener and the local sidecar server. This must be reflected in example config files, config parsing/validation, and user-facing documentation.

## Scope

- Add `server` to `config.example.json` and `config.example.yaml`.
- Document `server.a2a` and `server.sidecar` in `docs/user/config.md`.
- Note `serve` configuration defaults in `docs/user/cli.md`.
- Keep existing runtime behavior and defaults intact.

## Configuration Schema

```json
{
  "server": {
    "a2a": {
      "host": "127.0.0.1",
      "port": 7431,
      "tokens": []
    },
    "sidecar": {
      "socket": "/absolute/path/to/agent-message.sock",
      "allowConditional": false
    }
  }
}
```

- `server.a2a.host`: bind host/interface for the A2A HTTP server.
- `server.a2a.port`: bind port for the A2A HTTP server.
- `server.a2a.tokens`: optional list of bearer tokens for A2A auth.
- `server.sidecar.socket`: UDS path or Windows named pipe path for sidecar.
- `server.sidecar.allowConditional`: toggle conditional sidecar routes.

## Defaults

When fields are omitted, runtime defaults continue to apply:

- A2A host defaults to `127.0.0.1`.
- A2A port defaults to `7431`.
- Sidecar socket defaults to the OS user data directory path (see user docs).

## Compatibility

The new section is additive. Existing config files remain valid, and defaults are unchanged.

## Engineering Level

This change is **just right**: it expands documentation and examples to match already-supported runtime behavior without introducing new runtime complexity or scope creep.
