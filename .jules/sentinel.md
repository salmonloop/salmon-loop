## 2026-08-10 - Default Dangerous Patterns in SkillParser
**Vulnerability:** The default dangerous patterns in `SkillParser.extractCommands` (`DEFAULT_DANGEROUS_PATTERNS`) caught `curl ... | sh` but missed `wget ... | sh`, which is an equivalent vector for remote code execution via piped download. Also, variants like `bash`, `zsh`, or `python` were missed.
**Learning:** Hardcoded regexes for malicious shell patterns are prone to bypasses if they don't account for common aliases/alternatives (e.g., `wget` instead of `curl`, or `bash`/`zsh` instead of `sh`).
**Prevention:** Include broader shell command matching for network downloaders piped to interpreters.

## 2026-08-22 - Fix framework secrets leakage via execa extendEnv
**Vulnerability:** execa re-injects unsanitized process.env by default when extendEnv is true.
**Learning:** Using sanitizeEnvironment() but missing extendEnv: false defeated the purpose.
**Prevention:** Always explicitly set extendEnv: false when passing a sanitized environment object to execa.

## 2026-08-30 - Fix Quoted Secret Redaction Bypass
**Vulnerability:** The redaction regex `KV_PATTERN` failed to match and redact quoted secret values (e.g., `password="mysecret"`), potentially leaking credentials in audit logs.
**Learning:** Regular expressions for sanitizing key=value pairs must account for quoted values by explicitly including `"[^"]*"` and `'[^']*'` in the matching group.
**Prevention:** When writing regex for secrets matching, always include patterns for both quoted and unquoted strings to prevent simple bypasses.

## 2026-09-05 - Fix framework secrets leakage via execa extendEnv
**Vulnerability:** `execa` re-injects unsanitized `process.env` by default when `extendEnv` is true, causing framework secrets to leak into spawned processes.
**Learning:** Passing a sanitized environment object to `execa` is insufficient if `extendEnv: false` is not explicitly set, as `execa` merges the sanitized object with the unsanitized host `process.env`.
**Prevention:** Always explicitly set `extendEnv: false` when passing a sanitized environment object to `execa` in `src/core/tools/capability/runner.ts` and `src/cli/authorization/non-interactive.ts`.
