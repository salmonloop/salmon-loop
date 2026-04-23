# Server Config Top-Level Field

## Goal

Document the supported `server` top-level configuration section for the A2A HTTP listener and ACP persistence settings. This must be reflected in example config files, config parsing/validation, and user-facing documentation.

## Scope

- Add `server` to `config.example.json` and `config.example.yaml`.
- Document `server.a2a` and `server.acp` in `docs/user/config.md`.
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
    "acp": {
      "sessionStore": {
        "maxEntries": 200
      },
      "checkpointManifest": {
        "lockStaleMs": 30000
      }
    }
  }
}
```

- `server.a2a.host`: bind host/interface for the A2A HTTP server.
- `server.a2a.port`: bind port for the A2A HTTP server.
- `server.a2a.tokens`: optional list of bearer tokens for A2A auth.
- `server.acp.sessionStore.*`: ACP session retention and locking policy.
- `server.acp.checkpointManifest.*`: ACP checkpoint manifest locking policy.

## Defaults

When fields are omitted, runtime defaults continue to apply:

- A2A host defaults to `127.0.0.1`.
- A2A port defaults to `7431`.
- ACP store and checkpoint lock values use built-in defaults.

## Compatibility

The section remains additive around supported A2A and ACP fields, and defaults are unchanged.

## Engineering Level

This change is **just right**: it expands documentation and examples to match already-supported runtime behavior without introducing new runtime complexity or scope creep.
