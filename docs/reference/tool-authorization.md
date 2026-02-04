# Tool Authorization Allowlist

This reference describes the allowlist JSON schema and the `/auth` command.

## Allowlist Files

Allowlist file paths are resolved from `toolAuthorization.allowlist`:

- Repo scope: `.salmonloop/config/authorization.json` (relative to the repo root)
- User scope: `~/.salmonloop/authorization.json`

Both files share the same schema.

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
