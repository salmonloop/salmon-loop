# Tool Authorization Allowlist

This reference describes the allowlist JSON schema and the `/auth` command.

## Allowlist Files

Allowlist file paths are resolved from `toolAuthorization.allowlist`:

- Repo scope: `.salmonloop/config/authorization.json` (relative to the repo root)
- User scope: `~/.salmonloop/config/authorization-user.json`

Both files share the same schema.

## Path Safety

Allowlist paths are constrained to their scopes:

- Repo scope files must live under `<repo>/.salmonloop/`
- User scope files must live under `~/.salmonloop/`

Any path outside these roots is blocked and the allowlist is treated as empty.

## JSON Schema (v1)

```json
{
  "version": 1,
  "tools": {
    "tool.name": {
      "mode": "allow",
      "phases": {
        "CONTEXT": "allow"
      },
      "rules": [
        {
          "mode": "allow",
          "phase": "CONTEXT",
          "sideEffects": ["fs_read"],
          "argsHash": "sha256-hex"
        }
      ]
    }
  }
}
```

Notes:

- `tools` is a map of tool name → entry.
- `mode` is the fallback decision when no other rule matches.
- `phases` is an optional map of execution phase → decision.
- `rules` is an optional array of fine-grained rules.
- `argsHash` is a SHA-256 hex digest of the tool arguments.
- `sideEffects` must match all listed effects to qualify.
- Matching order is: rules (deny first, then allow), then `phases`, then `mode`.
- Decision precedence across scopes: user deny overrides repo allow; repo deny overrides user allow; otherwise user allow, then repo allow.

## `/auth` Command

Usage:

- `/auth list [repo|user]`
- `/auth add <repo|user> <tool> [phase] [args=<hash>] [effects=a,b] [deny]`
- `/auth remove <repo|user> <tool> [phase] [args=<hash>] [effects=a,b]`
- `/auth clear <repo|user>`
- `/auth hash <json-or-string>`
- `/auth reload`

Examples:

- `/auth add repo fs.read context`
- `/auth add user fs.write apply effects=fs_write`
- `/auth remove repo fs.read context`
- `/auth list repo`
- `/auth hash {"path":"README.md"}`

`/auth hash` normalizes JSON input before hashing to keep hashes stable.

## Locking and Audit Events

Allowlist writes are serialized using:

- An in-process queue (prevents concurrent writes in a single process)
- A cross-process file lock (prevents concurrent writes across processes)

The following audit events are emitted for lock lifecycle visibility:

- `ALLOWLIST_LOCK_ACQUIRED`
- `ALLOWLIST_LOCK_STALE_REMOVED`
- `ALLOWLIST_LOCK_RELEASED`
- `ALLOWLIST_LOCK_TIMEOUT`

See `docs/reference/audit-log-spec.md` for event field details.

## Cache Behavior

Allowlist loads use a cache file co-located under the runtime state directories:

- Repo scope: `<repo>/.salmonloop/state/allowlist-cache-<hash>.json`
- User scope: `~/.salmonloop/allowlist-cache-<hash>.json`

The cache is validated by version, source path, file size, mtime, and content hash.
If any of these checks fail, the allowlist file is re-read and a new cache entry is written.
When the allowlist JSON is invalid, the system falls back to an empty allowlist.
